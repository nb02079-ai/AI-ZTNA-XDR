// 모의 제공자. 네트워크를 전혀 쓰지 않으며, 시험과 오프라인 파이프라인 검증에 씁니다.
// config.mock.responder(req) 로 응답을 주입하거나, config.mock.text 로 고정 문자열을 줍니다.
import { AiError } from '../errors.mjs';

const DEFAULT_TEXT = JSON.stringify({ action: 'record', confidence: 0, reason: 'mock 기본 응답' });

export function createMockProvider(config = {}) {
  const responder = config.mock?.responder;
  const fixedText = config.mock?.text;
  const state = { calls: 0, lastRequest: null };

  const provider = {
    name: 'mock',
    model: config.model || 'mock',
    state,
    async generate(req = {}) {
      state.calls += 1;
      state.lastRequest = req;
      const text = typeof responder === 'function' ? responder(req) : (fixedText ?? DEFAULT_TEXT);
      if (typeof text !== 'string') {
        throw new AiError('mock 응답이 문자열이 아닙니다', { kind: 'format', provider: 'mock' });
      }
      return { text, provider: 'mock', model: provider.model, usage: null };
    },
  };
  return provider;
}
