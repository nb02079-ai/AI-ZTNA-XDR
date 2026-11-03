// Claude API(Messages) 제공자. 외부 의존성 없이 fetch로 직접 호출합니다.
import { AiError } from '../errors.mjs';
import { fetchWithTimeout } from '../http.mjs';

export function createClaudeProvider(config) {
  const {
    model,
    apiKey = '',
    apiUrl = 'https://api.anthropic.com/v1/messages',
    anthropicVersion = '2023-06-01',
    fetchImpl,
  } = config;

  return {
    name: 'claude',
    model,
    /**
     * @param {{system?:string, user?:string, messages?:Array<{role:string,content:string}>, maxTokens?:number, temperature?:number, timeoutMs?:number}} [req]
     */
    async generate(req = {}) {
      if (!apiKey) {
        throw new AiError('ANTHROPIC_API_KEY가 설정되지 않았습니다', { kind: 'config', provider: 'claude' });
      }
      const messages = req.messages
        ?? (req.user != null ? [{ role: 'user', content: String(req.user) }] : []);
      if (messages.length === 0) {
        throw new AiError('보낼 메시지가 없습니다', { kind: 'config', provider: 'claude' });
      }

      const body = {
        model,
        max_tokens: req.maxTokens ?? config.maxTokens ?? 1024,
        temperature: req.temperature ?? config.temperature ?? 0,
        messages,
      };
      if (req.system) body.system = String(req.system);

      const res = await fetchWithTimeout(
        apiUrl,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': anthropicVersion,
          },
          body: JSON.stringify(body),
        },
        req.timeoutMs ?? config.timeoutMs ?? 30000,
        fetchImpl,
      );

      if (!res.ok) {
        let detail = '';
        try { detail = await res.text(); } catch { /* 본문 없음 */ }
        throw new AiError(`Claude API 오류 ${res.status}`, {
          kind: 'http',
          status: res.status,
          provider: 'claude',
          cause: detail ? new Error(detail.slice(0, 500)) : undefined,
        });
      }

      const data = await res.json();
      const text = Array.isArray(data?.content)
        ? data.content.filter((b) => b && b.type === 'text').map((b) => b.text).join('')
        : '';
      if (!text) {
        throw new AiError('Claude 응답에 텍스트가 없습니다', { kind: 'format', provider: 'claude' });
      }
      return { text, provider: 'claude', model, usage: data?.usage };
    },
  };
}
