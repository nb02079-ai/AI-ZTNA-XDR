// 규칙 폴백: 복사해 둔 aleph-source/xdr/<모듈>/decide.mjs 의 decide(alert)를 불러 씁니다.
// AI 호출이 실패하거나 형식이 틀렸을 때, 이 규칙 판정으로 떨어져 파이프라인이 멈추지 않게 합니다.
// 원본 decide.mjs는 고치지 않고 그대로 불러 씁니다(채점 저장소와 동일한 판정 기준 유지).
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MODULE_KEYS = Object.freeze([
  'brute-force', 'web-injection', 'known-cve', 'persistence', 'privilege', 'exfiltration',
]);

const ACTIONS = new Set(['block', 'alert', 'record']);

// 저장소 루트(= src/engine 에서 두 단계 위)
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** decide 반환이 올바른 판정인지 검사합니다(vault 실행기와 같은 기준). */
export function isDecision(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && ACTIONS.has(value.action)
    && typeof value.confidence === 'number'
    && Number.isFinite(value.confidence)
    && value.confidence >= 0
    && value.confidence <= 1
    && typeof value.reason === 'string';
}

const cache = new Map();

/**
 * 모듈의 규칙 decide 함수를 불러옵니다(한 번 불러 캐시).
 * @param {string} moduleKey
 * @param {string} [root] 시험에서 다른 경로를 주입할 때 사용
 * @returns {Promise<(alert:any)=>any>}
 */
export async function loadRuleDecide(moduleKey, root = ROOT) {
  if (!MODULE_KEYS.includes(moduleKey)) {
    throw new Error(`알 수 없는 모듈: ${moduleKey}`);
  }
  const key = `${root}::${moduleKey}`;
  if (cache.has(key)) return cache.get(key);
  const file = join(root, 'aleph-source', 'xdr', moduleKey, 'decide.mjs');
  const mod = await import(pathToFileURL(file).href);
  if (typeof mod.decide !== 'function') {
    throw new Error(`${moduleKey}/decide.mjs 가 decide 함수를 내보내지 않습니다`);
  }
  cache.set(key, mod.decide);
  return mod.decide;
}

/**
 * 규칙 판정을 돌려줍니다. 규칙이 형식에 맞지 않으면 record로 안전하게 정규화합니다.
 * @param {string} moduleKey
 * @param {any} alert
 * @param {string} [root]
 * @returns {Promise<{action:string, confidence:number, reason:string}>}
 */
export async function ruleDecide(moduleKey, alert, root = ROOT) {
  const decide = await loadRuleDecide(moduleKey, root);
  try {
    const out = await decide(alert);
    if (isDecision(out)) {
      return { action: out.action, confidence: out.confidence, reason: out.reason };
    }
    return { action: 'record', confidence: 0, reason: '규칙 판정이 형식에 맞지 않아 기록만 합니다' };
  } catch (error) {
    return {
      action: 'record',
      confidence: 0,
      reason: `규칙 판정 중 오류: ${error && error.message ? error.message : String(error)}`,
    };
  }
}
