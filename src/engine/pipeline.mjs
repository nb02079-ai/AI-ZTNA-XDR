// 파이프라인: 경보 하나를 판정 → (block·alert면) 설명 → 집행까지 한 번에 처리합니다.
// record 경보는 설명을 만들지 않습니다(허용이라 설명할 사건이 없음).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideAlert } from './decider.mjs';
import { explainAlert } from './explainer.mjs';
import { createEnforcer } from '../ztna/enforce.mjs';
import { MODULE_KEYS } from './rule-fallback.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** fixture 파일을 읽어 경보 배열을 돌려줍니다. */
export async function loadFixture(moduleKey, root = ROOT) {
  if (!MODULE_KEYS.includes(moduleKey)) throw new Error(`알 수 없는 모듈: ${moduleKey}`);
  const file = join(root, 'aleph-source', 'fixtures', `${moduleKey}.json`);
  const parsed = JSON.parse(await readFile(file, 'utf8'));
  return Array.isArray(parsed.alerts) ? parsed.alerts : [];
}

/**
 * 경보 하나를 끝까지 처리합니다.
 * @returns {Promise<{alertId, decision, explanation, enforcement}>}
 */
export async function processAlert({ moduleKey, alert, provider, enforcer, config = {}, root }) {
  const decision = await decideAlert({ moduleKey, alert, provider, config, root });

  let explanation = null;
  if (decision.action === 'block' || decision.action === 'alert') {
    explanation = await explainAlert({ moduleKey, alert, decision, provider, config, root });
  }

  const enforcement = await enforcer.enforce(alert, decision);

  return {
    alertId: alert?.id ?? null,
    decision,
    explanation,
    enforcement,
  };
}

/**
 * 한 모듈의 fixture 전체를 처리하고 요약을 돌려줍니다.
 * @param {object} args
 * @param {string} args.moduleKey
 * @param {{generate:Function}} args.provider
 * @param {object} [args.enforcerOpts]  createEnforcer 옵션(now·logFile 등)
 * @param {object} [args.config]
 * @param {string} [args.root]
 */
export async function runModule({ moduleKey, provider, enforcerOpts = {}, config = {}, root }) {
  const alerts = await loadFixture(moduleKey, root);
  // 경보 시각을 시계로 써서 만료·중복이 흐름대로 재현되게 한다(respond.mjs 원본 동작과 동일).
  const ordered = [...alerts].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  // 공유 시계: 각 경보를 처리하기 직전에 그 경보 시각으로 맞춘다.
  // enforcerOpts.now를 주면 그것을 그대로 쓰고(시험에서 고정 시계), 없으면 경보 시각을 따라간다.
  let clock = ordered.length > 0 ? Date.parse(ordered[0].timestamp) : 0;
  const now = enforcerOpts.now ?? (() => clock);
  const enforcer = await createEnforcer(moduleKey, { root, ...enforcerOpts, now });

  const rows = [];
  const summary = {
    module: moduleKey,
    total: ordered.length,
    decision: { block: 0, alert: 0, record: 0 },
    source: { ai: 0, rule: 0 },
    access: { enforce: 0, review: 0, allow: 0 },
    explained: 0,
    explanationRejected: 0,
    enforcedRules: 0,
  };

  for (const alert of ordered) {
    // 이 경보 시각으로 공유 시계를 맞춘다(enforcerOpts.now 고정 시계면 그대로 둔다).
    if (!enforcerOpts.now) clock = Date.parse(alert.timestamp);
    const row = await processAlert({ moduleKey, alert, provider, enforcer, config, root });
    rows.push(row);

    summary.decision[row.decision.action] = (summary.decision[row.decision.action] ?? 0) + 1;
    summary.source[row.decision.source] = (summary.source[row.decision.source] ?? 0) + 1;
    summary.access[row.enforcement.access] = (summary.access[row.enforcement.access] ?? 0) + 1;
    if (row.explanation?.ok) summary.explained += 1;
    if (row.explanation && !row.explanation.ok) summary.explanationRejected += 1;
    if (row.enforcement.rule) summary.enforcedRules += 1;
  }

  summary.activeRules = enforcer.denyList.active().length;
  return { summary, rows };
}
