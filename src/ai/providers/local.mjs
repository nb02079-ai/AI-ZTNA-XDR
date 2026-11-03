// 로컬 모델 제공자. Ollama의 /api/chat 엔드포인트를 씁니다(외부 전송 없음).
// responseFormat: 'json' 을 주면 Ollama의 format:'json' 으로 JSON 출력을 강제합니다.
import { AiError } from '../errors.mjs';
import { fetchWithTimeout } from '../http.mjs';

export function createLocalProvider(config) {
  const { model, baseUrl = 'http://127.0.0.1:11434', fetchImpl } = config;
  const chatUrl = `${String(baseUrl).replace(/\/+$/, '')}/api/chat`;

  return {
    name: 'local',
    model,
    /**
     * @param {{system?:string, user?:string, messages?:Array<{role:string,content:string}>, maxTokens?:number, temperature?:number, timeoutMs?:number, responseFormat?:'json'|'text'}} [req]
     */
    async generate(req = {}) {
      const messages = [];
      if (req.system) messages.push({ role: 'system', content: String(req.system) });
      if (req.messages) messages.push(...req.messages);
      else if (req.user != null) messages.push({ role: 'user', content: String(req.user) });
      if (messages.length === 0) {
        throw new AiError('보낼 메시지가 없습니다', { kind: 'config', provider: 'local' });
      }

      const body = {
        model,
        messages,
        stream: false,
        options: {
          temperature: req.temperature ?? config.temperature ?? 0,
          num_predict: req.maxTokens ?? config.maxTokens ?? 1024,
        },
      };
      if (req.responseFormat === 'json') body.format = 'json';

      const res = await fetchWithTimeout(
        chatUrl,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
        req.timeoutMs ?? config.timeoutMs ?? 30000,
        fetchImpl,
      );

      if (!res.ok) {
        let detail = '';
        try { detail = await res.text(); } catch { /* 본문 없음 */ }
        throw new AiError(`로컬 모델 오류 ${res.status}`, {
          kind: 'http',
          status: res.status,
          provider: 'local',
          cause: detail ? new Error(detail.slice(0, 500)) : undefined,
        });
      }

      const data = await res.json();
      const text = data?.message?.content ?? '';
      if (!text) {
        throw new AiError('로컬 모델 응답에 내용이 없습니다', { kind: 'format', provider: 'local' });
      }
      return {
        text,
        provider: 'local',
        model,
        usage: { prompt_eval_count: data?.prompt_eval_count, eval_count: data?.eval_count },
      };
    },
  };
}
