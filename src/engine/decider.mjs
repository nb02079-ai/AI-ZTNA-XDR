// AI 판정기: 경보 하나를 AI로 분류하고, 실패하면 규칙 판정으로 떨어집니다.
// 반환은 vault 실행기와 같은 {action, confidence, reason}에 더해, 출처(source)·폴백 사유를 붙입니다.
import { extractJson } from '../ai/json.mjs';
import { AiError } from '../ai/errors.mjs';
import { loadPatterns, summarizePatterns } from './patterns.mjs';
import { buildDecisionPrompt } from './prompt.mjs';
import { ruleDecide, isDecision } from './rule-fallback.mjs';

const ACTIONS = new Set(['block', 'alert', 'record']);

/** AI가 돌려준 객체를 판정으로 정규화합니다. 어긋나면 null을 돌려줍니다(=폴백 신호). */
function normalizeDecision(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const action = typeof obj.action === 'string' ? obj.action.trim().toLowerCase() : '';
  if (!ACTIONS.has(action)) return null;
  let confidence = Number(obj.confidence);
  if (!Number.isFinite(confidence)) return null;
  // 범위를 벗어난 값은 자르지 않고 0~1로 조인다(모델이 1을 넘겨도 안전).
  confidence = Math.min(1, Math.max(0, confidence));
  const reason = typeof obj.reason === 'string' && obj.reason.trim()
    ? obj.reason.trim()
    : '(이유 없음)';
  return { action, confidence, reason };
}

/**
 * 경보 하나를 판정합니다.
 * @param {object} args
 * @param {string} args.moduleKey
 * @param {any} args.alert
 * @param {{generate:Function}} args.provider  src/ai 제공자
 * @param {object} [args.config]  호출 옵션(maxTokens 등)
 * @param {string} [args.root]  시험용 경로 주입
 * @returns {Promise<{action:string,confidence:number,reason:string,source:'ai'|'rule',fallback:(null|{kind:string,message:string})}>}
 */
export async function decideAlert({ moduleKey, alert, provider, config = {}, root }) {
  const rawPatterns = await loadPatterns(moduleKey, root);
  const patterns = summarizePatterns(rawPatterns);
  const { system, user } = buildDecisionPrompt({ moduleKey, alert, patterns });

  let fallbackReason = null;
  try {
    const res = await provider.generate({
      system,
      user,
      responseFormat: 'json',
      maxTokens: config.maxTokens ?? 512,
      temperature: config.temperature ?? 0,
      timeoutMs: config.timeoutMs,
    });
    const parsed = extractJson(res.text);
    const decision = normalizeDecision(parsed);
    if (decision) {
      return { ...decision, source: 'ai', fallback: null };
    }
    fallbackReason = { kind: 'format', message: 'AI 응답이 판정 형식에 맞지 않습니다' };
  } catch (error) {
    if (error instanceof AiError) {
      fallbackReason = { kind: error.kind, message: error.message };
    } else {
      fallbackReason = { kind: 'unknown', message: error && error.message ? error.message : String(error) };
    }
  }

  // 폴백: 규칙 판정
  const ruled = await ruleDecide(moduleKey, alert, root);
  return { ...ruled, source: 'rule', fallback: fallbackReason };
}

export { normalizeDecision, isDecision };
