// ZTNA 집행 매핑: 판정(action/confidence)을 제로 트러스트 접근 결정으로 잇습니다.
// 모듈마다 차단 단위가 다릅니다(복사한 respond.mjs에 이미 정의됨). 여기서는 그 안전장치를
// 재사용해 거부 규칙을 만들고, "무엇을 어떤 범위로 막는지"를 한 형태로 정리합니다.
//   block(확신 0.85+)  → enforce: 거부 규칙 생성(주소/계정/호스트)
//   alert              → review: 사람 확인(막지 않음)
//   record             → allow: 평소대로 허용
// respond.mjs의 add()가 안전장치(내부망 제외·주소 검증·중복·상한·성공 혼재 등)를 모두 처리합니다.
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MODULE_KEYS } from '../engine/rule-fallback.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// 모듈별 집행 성격: 무엇을 막는가(target), 어떤 ZTNA 행위인가(kind).
// 값은 respond.mjs의 RULE_ID·reasonCode와 맞춰 둔다(코드가 바뀌면 add()의 rule에서 실제 값을 읽어 덮는다).
export const ENFORCEMENT = Object.freeze({
  'brute-force':  { kind: 'deny_source',       targetField: 'srcip',   scope: '출발 주소 거부' },
  'web-injection':{ kind: 'deny_source',       targetField: 'srcip',   scope: '출발 주소 거부' },
  'known-cve':    { kind: 'deny_source',       targetField: 'srcip',   scope: '출발 주소 거부' },
  'persistence':  { kind: 'isolate_host',      targetField: 'srcip',   scope: '호스트 격리' },
  'privilege':    { kind: 'revoke_session',    targetField: 'srcuser', scope: '계정 세션 거둠' },
  'exfiltration': { kind: 'block_destination', targetField: 'dstip',   scope: '목적지 차단' },
});

const respondCache = new Map();

/** 모듈의 respond.mjs를 불러옵니다(createDenyList·respond 재사용). */
export async function loadRespond(moduleKey, root = ROOT) {
  if (!MODULE_KEYS.includes(moduleKey)) throw new Error(`알 수 없는 모듈: ${moduleKey}`);
  const key = `${root}::${moduleKey}`;
  if (respondCache.has(key)) return respondCache.get(key);
  const file = join(root, 'aleph-source', 'xdr', moduleKey, 'respond.mjs');
  const mod = await import(pathToFileURL(file).href);
  if (typeof mod.createDenyList !== 'function' || typeof mod.respond !== 'function') {
    throw new Error(`${moduleKey}/respond.mjs 가 createDenyList·respond 를 내보내지 않습니다`);
  }
  respondCache.set(key, mod);
  return mod;
}

/**
 * 한 모듈의 집행기를 만듭니다. 경보+판정을 받아 접근 결정을 돌려줍니다.
 * denyList는 모듈 안에서 공유되어, 중복·상한·만료가 경보 흐름 전체에 걸쳐 작동합니다.
 * @param {string} moduleKey
 * @param {{now?:Function, ttlMs?:number, maxRules?:number, protectedAddresses?:string[], logFile?:string, root?:string}} [opts]
 */
export async function createEnforcer(moduleKey, opts = {}) {
  const mod = await loadRespond(moduleKey, opts.root);
  const meta = ENFORCEMENT[moduleKey];
  const denyList = mod.createDenyList({
    now: opts.now,
    ttlMs: opts.ttlMs,
    maxRules: opts.maxRules,
    protectedAddresses: opts.protectedAddresses,
  });
  // respond.mjs의 기본 로그 경로는 복사 자산 폴더 안(../alerts.log)이라 원본을 오염시킨다.
  // logFile을 주지 않으면 os 임시 경로로 돌려 저장소 밖에 쓰게 한다.
  const logFile = opts.logFile || join(tmpdir(), `ai-ztna-xdr-${moduleKey}.alerts.log`);
  const respondOpts = { denyList, now: opts.now, logFile };

  return {
    moduleKey,
    meta,
    denyList,
    /**
     * @param {object} alert
     * @param {{action:string,confidence:number,reason?:string}} decision
     * @returns {Promise<{module:string, decisionAction:string, access:'enforce'|'review'|'allow', kind:string, scope:string, target:(string|null), rule:(object|null), outcome:string, skipped?:string, reasonCode:(string|null)}>}
     */
    async enforce(alert, decision) {
      const result = await mod.respond(alert, decision, respondOpts);
      const target = alert?.data?.[meta.targetField] != null ? String(alert.data[meta.targetField]) : null;

      let access;
      if (result.outcome === 'denied') access = 'enforce';
      else if (result.outcome === 'alerted') access = 'review';
      else access = 'allow';

      return {
        module: moduleKey,
        decisionAction: decision?.action ?? 'record',
        access,
        kind: meta.kind,
        scope: meta.scope,
        target,
        rule: result.rule ?? null,
        reasonCode: result.rule ? (mod.DEFAULT_REASON_CODE ?? null) : null,
        outcome: result.outcome,
        skipped: result.skipped,
      };
    },
  };
}
