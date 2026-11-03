// AI 호출 과정에서 나는 오류를 한 종류로 묶습니다.
// kind로 원인을 구분하고, aiFailure 표시로 상위 판정기가 "규칙 폴백" 판단에 씁니다.

/** @typedef {'config'|'network'|'timeout'|'http'|'format'|'unknown'} AiErrorKind */

export class AiError extends Error {
  /**
   * @param {string} message
   * @param {{ kind?: AiErrorKind, status?: number, provider?: string, cause?: unknown }} [opts]
   */
  constructor(message, opts = {}) {
    super(message);
    this.name = 'AiError';
    this.kind = opts.kind ?? 'unknown';
    this.status = opts.status;
    this.provider = opts.provider;
    // AI 호출 실패를 뜻합니다. 판정기는 이 표시를 보고 규칙 판정으로 떨어집니다.
    this.aiFailure = true;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}
