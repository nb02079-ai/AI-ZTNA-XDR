// 시간 초과가 있는 fetch 래퍼입니다. 실제 네트워크 호출은 여기 한 곳으로 모읍니다.
// fetchImpl을 주입하면 시험에서 네트워크 없이 요청 구성을 검사할 수 있습니다.
import { AiError } from './errors.mjs';

/**
 * @param {string} url
 * @param {RequestInit} options
 * @param {number} timeoutMs
 * @param {typeof fetch} [fetchImpl]
 */
export async function fetchWithTimeout(url, options, timeoutMs, fetchImpl) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new AiError('이 환경에서 fetch를 쓸 수 없습니다(Node 18+ 필요)', { kind: 'config' });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs | 0));
  try {
    return await doFetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new AiError(`요청 시간 초과(${timeoutMs}ms)`, { kind: 'timeout', cause: error });
    }
    throw new AiError(`네트워크 요청 실패: ${error && error.message ? error.message : String(error)}`, { kind: 'network', cause: error });
  } finally {
    clearTimeout(timer);
  }
}
