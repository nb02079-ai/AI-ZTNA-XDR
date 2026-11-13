// 작업 스텝 6 검증: 판정 → 설명 → 집행 전 과정을 네트워크 없이 통합 시험합니다.
// 규칙 판정을 AI 응답인 척 돌려주는 mock으로, 여섯 모듈 전부를 결정적으로 흘려보냅니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runModule, loadFixture } from '../src/engine/pipeline.mjs';
import { ruleDecide, MODULE_KEYS } from '../src/engine/rule-fallback.mjs';
import { loadPatterns, summarizePatterns } from '../src/engine/patterns.mjs';
import { createMockProvider } from '../src/ai/providers/mock.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

// 규칙 판정을 그대로 AI JSON으로 돌려주고, 설명은 첫 패턴 이름을 근거로 다는 mock.
function ruleOracle(moduleKey, patternNames) {
  return {
    name: 'rule-oracle',
    async generate(req) {
      const isExplain = req.user.includes('에 대한 설명을 JSON');
      const m = req.user.match(/\{[\s\S]*\}/);
      const alert = m ? JSON.parse(m[0]) : {};
      if (isExplain) {
        return { text: JSON.stringify({ alertId: alert.id, explanation: '규칙 근거에 따른 설명입니다.', evidence: [patternNames[0]] }) };
      }
      const d = await ruleDecide(moduleKey, alert, ROOT);
      return { text: JSON.stringify({ action: d.action, confidence: d.confidence, reason: d.reason }) };
    },
  };
}

test('파이프라인: 여섯 모듈 전부 끝까지 처리(총계 일치)', async () => {
  for (const mk of MODULE_KEYS) {
    const alerts = await loadFixture(mk, ROOT);
    const pats = summarizePatterns(await loadPatterns(mk, ROOT)).items.map((p) => p.name);
    const { summary, rows } = await runModule({ moduleKey: mk, provider: ruleOracle(mk, pats), root: ROOT });

    assert.equal(summary.total, alerts.length, `${mk} 총계`);
    assert.equal(rows.length, alerts.length, `${mk} 행 수`);
    // 판정 세 종 합 = 총계
    const dsum = summary.decision.block + summary.decision.alert + summary.decision.record;
    assert.equal(dsum, summary.total, `${mk} 판정 합`);
    // 접근 세 종 합 = 총계
    const asum = summary.access.enforce + summary.access.review + summary.access.allow;
    assert.equal(asum, summary.total, `${mk} 접근 합`);
  }
});

test('파이프라인: record는 설명을 만들지 않고 allow로 간다', async () => {
  const mk = 'brute-force';
  const pats = summarizePatterns(await loadPatterns(mk, ROOT)).items.map((p) => p.name);
  const { rows } = await runModule({ moduleKey: mk, provider: ruleOracle(mk, pats), root: ROOT });
  for (const row of rows) {
    if (row.decision.action === 'record') {
      assert.equal(row.explanation, null, 'record는 설명 없음');
      assert.equal(row.enforcement.access, 'allow');
    }
  }
});

test('파이프라인: block은 enforce 또는 review(안전장치로 skip된 경우)', async () => {
  const mk = 'exfiltration';
  const pats = summarizePatterns(await loadPatterns(mk, ROOT)).items.map((p) => p.name);
  const { rows } = await runModule({ moduleKey: mk, provider: ruleOracle(mk, pats), root: ROOT });
  for (const row of rows) {
    if (row.decision.action === 'block') {
      assert.ok(['enforce', 'review'].includes(row.enforcement.access), 'block은 enforce 또는 review');
    }
  }
});

test('파이프라인: AI가 깨진 응답이면 규칙 폴백으로 끝까지 처리', async () => {
  const mk = 'known-cve';
  // 판정·설명 모두 비정상 → 판정은 규칙 폴백, 설명은 거부되어도 파이프라인은 완주
  const provider = createMockProvider({ mock: { text: '도움을 드릴 수 없습니다' } });
  const { summary, rows } = await runModule({ moduleKey: mk, provider, root: ROOT });
  assert.equal(summary.source.rule, summary.total, '모든 판정이 규칙 폴백');
  assert.equal(rows.length, summary.total);
  // 설명이 시도된 경보(block·alert)는 전부 거부로 집계
  const tried = rows.filter((r) => r.explanation).length;
  assert.equal(summary.explanationRejected, tried);
});

test('파이프라인: 결정적(같은 입력이면 같은 요약)', async () => {
  const mk = 'privilege';
  const pats = summarizePatterns(await loadPatterns(mk, ROOT)).items.map((p) => p.name);
  const a = await runModule({ moduleKey: mk, provider: ruleOracle(mk, pats), root: ROOT });
  const b = await runModule({ moduleKey: mk, provider: ruleOracle(mk, pats), root: ROOT });
  assert.deepEqual(a.summary, b.summary);
});

test('파이프라인: AI 호출 실패 시 각 행에 폴백 사유가 담긴다(진단용)', async () => {
  const mk = 'brute-force';
  const provider = { name: 'boom', async generate() {
    const { AiError } = await import('../src/ai/errors.mjs');
    throw new AiError('키 없음', { kind: 'config' });
  } };
  const injected = [{
    id: 'inj-fb', timestamp: '2026-11-13T10:00:00+09:00', agent: { name: 'x' },
    rule: { level: 12, description: '같은 주소에서 로그인 실패 40건이 쌓였습니다.' },
    data: { srcip: '203.0.113.99', srcuser: 'u', count: '40' },
  }];
  const { rows } = await runModule({ moduleKey: mk, provider, root: ROOT, alerts: injected });
  assert.equal(rows[0].decision.source, 'rule');
  assert.ok(rows[0].decision.fallback, '폴백 사유 객체 존재');
  assert.equal(rows[0].decision.fallback.kind, 'config');
});

test('파이프라인: alerts를 직접 주입하면 fixture 대신 그 경보를 처리(보고서 경로)', async () => {
  const mk = 'brute-force';
  const pats = summarizePatterns(await loadPatterns(mk, ROOT)).items.map((p) => p.name);
  const injected = [{
    id: 'inj-01', timestamp: '2026-11-12T10:00:00+09:00', agent: { name: 'x' },
    rule: { level: 12, description: '같은 주소에서 로그인 실패 40건이 쌓였습니다.' },
    data: { srcip: '203.0.113.99', srcuser: 'u', count: '40' },
  }];
  const { summary, rows } = await runModule({ moduleKey: mk, provider: ruleOracle(mk, pats), root: ROOT, alerts: injected });
  assert.equal(summary.total, 1);
  assert.equal(rows[0].alertId, 'inj-01');
  assert.equal(rows[0].decision.action, 'block');
  assert.equal(rows[0].enforcement.access, 'enforce');
});
