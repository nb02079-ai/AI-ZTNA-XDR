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
        messages,
      };
      // temperature는 명시된 경우에만 보낸다. Sonnet 5.5 등 일부 모델은 이 파라미터를 거부한다(HTTP 400).
      const temperature = req.temperature ?? config.temperature;
      if (temperature !== undefined && temperature !== null) body.temperature = temperature;
      if (req.system) body.system = String(req.system);

      const timeoutMs = req.timeoutMs ?? config.timeoutMs ?? 30000;

      // 한 번 보내고, 응답을 돌려준다(비200이면 상태·본문을 함께).
      const send = async (payload) => {
        const r = await fetchWithTimeout(
          apiUrl,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': anthropicVersion,
            },
            body: JSON.stringify(payload),
          },
          timeoutMs,
          fetchImpl,
        );
        if (r.ok) return { ok: true, res: r };
        let detail = '';
        try { detail = await r.text(); } catch { /* 본문 없음 */ }
        return { ok: false, status: r.status, detail };
      };

      let out = await send(body);

      // 보강: 모델이 temperature(또는 다른 파라미터)를 거부하는 400이면, 그 파라미터를 빼고 1회 재시도한다.
      // .env에 temperature가 남아 있거나 호출부가 값을 넘겨도 이 오류로는 멈추지 않게 한다.
      if (!out.ok && out.status === 400 && 'temperature' in body && /temperature/i.test(out.detail) && /(deprecat|not supported|unsupported|unexpected)/i.test(out.detail)) {
        const retryBody = { ...body };
        delete retryBody.temperature;
        out = await send(retryBody);
      }

      if (!out.ok) {
        throw new AiError(`Claude API 오류 ${out.status}`, {
          kind: 'http',
          status: out.status,
          provider: 'claude',
          cause: out.detail ? new Error(out.detail.slice(0, 500)) : undefined,
        });
      }

      const data = await out.res.json();
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
