// 작업 스텝 3 검증: AI 판정기와 규칙 폴백을 네트워크 없이 시험합니다.
// 실제 fixtures와 복사된 규칙 decide.mjs를 쓰되, AI는 mock 제공자로 주입합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { decideAlert, normalizeDecision } from '../src/engine/decider.mjs';
import { ruleDecide, MODULE_KEYS, isDecision } from '../src/engine/rule-fallback.mjs';
import { loadPatterns, summarizePatterns } from '../src/engine/patterns.mjs';
import { createMockProvider } from '../src/ai/providers/mock.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

async function firstAlert(moduleKey) {
  const f = JSON.parse(await readFile(join(ROOT, 'aleph-source', 'fixtures', `${moduleKey}.json`), 'utf8'));
  return f.alerts[0];
}

// --- normalizeDecision ---
test('normalizeDecision: 정상 판정 통과', () => {
  const d = normalizeDecision({ action: 'BLOCK', confidence: 0.9, reason: 'x' });
  assert.equal(d.action, 'block');
  assert.equal(d.confidence, 0.9);
});

test('normalizeDecision: 범위 밖 confidence는 0~1로 조임', () => {
  assert.equal(normalizeDecision({ action: 'alert', confidence: 1.5, reason: 'r' }).confidence, 1);
  assert.equal(normalizeDecision({ action: 'alert', confidence: -3, reason: 'r' }).confidence, 0);
});

test('normalizeDecision: 잘못된 action은 null', () => {
  assert.equal(normalizeDecision({ action: 'drop', confidence: 0.5, reason: 'r' }), null);
  assert.equal(normalizeDecision({ action: 'block', confidence: 'x', reason: 'r' }), null);
  assert.equal(normalizeDecision(null), null);
});

// --- 규칙 폴백 로더: 여섯 모듈 모두 불러져야 함 ---
test('ruleDecide: 여섯 모듈 규칙이 모두 판정을 돌려준다', async () => {
  for (const m of MODULE_KEYS) {
    const alert = await firstAlert(m);
    const out = await ruleDecide(m, alert, ROOT);
    assert.ok(isDecision(out), `${m} 규칙 판정 형식`);
  }
});

// --- patterns 요약 ---
test('summarizePatterns: 패턴 항목을 추린다', async () => {
  const p = summarizePatterns(await loadPatterns('known-cve', ROOT));
  assert.ok(Array.isArray(p.items) && p.items.length > 0);
  assert.ok(typeof p.items[0].name === 'string');
});

// --- AI 경로: mock이 올바른 JSON을 주면 source=ai ---
test('decideAlert: AI가 올바른 JSON이면 AI 판정을 쓴다', async () => {
  const provider = createMockProvider({ mock: { text: '{"action":"block","confidence":0.92,"reason":"테스트 근거"}' } });
  const alert = await firstAlert('brute-force');
  const d = await decideAlert({ moduleKey: 'brute-force', alert, provider, root: ROOT });
  assert.equal(d.source, 'ai');
  assert.equal(d.action, 'block');
  assert.equal(d.confidence, 0.92);
  assert.equal(d.fallback, null);
});

test('decideAlert: AI 프롬프트에 모듈·경보가 담긴다', async () => {
  const provider = createMockProvider({ mock: { responder: (req) => {
    assert.ok(req.system.includes('block'));
    assert.ok(req.user.includes('brute-force'));
    return '{"action":"alert","confidence":0.5,"reason":"r"}';
  } } });
  const alert = await firstAlert('brute-force');
  const d = await decideAlert({ moduleKey: 'brute-force', alert, provider, root: ROOT });
  assert.equal(d.action, 'alert');
});

// --- 폴백: AI가 깨진 응답을 주면 규칙으로 떨어진다 ---
test('decideAlert: AI가 JSON이 아니면 규칙 폴백(format)', async () => {
  const provider = createMockProvider({ mock: { text: '죄송하지만 분류할 수 없습니다.' } });
  const alert = await firstAlert('persistence');
  const d = await decideAlert({ moduleKey: 'persistence', alert, provider, root: ROOT });
  assert.equal(d.source, 'rule');
  assert.equal(d.fallback.kind, 'format');
  assert.ok(isDecision(d));
});

test('decideAlert: AI가 잘못된 action이면 규칙 폴백', async () => {
  const provider = createMockProvider({ mock: { text: '{"action":"quarantine","confidence":0.9,"reason":"r"}' } });
  const alert = await firstAlert('privilege');
  const d = await decideAlert({ moduleKey: 'privilege', alert, provider, root: ROOT });
  assert.equal(d.source, 'rule');
  assert.equal(d.fallback.kind, 'format');
});

test('decideAlert: AI 호출이 던지면 규칙 폴백(그 kind 보존)', async () => {
  const provider = {
    name: 'boom',
    async generate() {
      const { AiError } = await import('../src/ai/errors.mjs');
      throw new AiError('네트워크 끊김', { kind: 'network' });
    },
  };
  const alert = await firstAlert('exfiltration');
  const d = await decideAlert({ moduleKey: 'exfiltration', alert, provider, root: ROOT });
  assert.equal(d.source, 'rule');
  assert.equal(d.fallback.kind, 'network');
  assert.ok(isDecision(d));
});

test('decideAlert: 코드펜스가 섞인 AI 응답도 파싱한다', async () => {
  const provider = createMockProvider({ mock: { text: '판정합니다.\n```json\n{"action":"record","confidence":0.1,"reason":"정상"}\n```' } });
  const alert = await firstAlert('web-injection');
  const d = await decideAlert({ moduleKey: 'web-injection', alert, provider, root: ROOT });
  assert.equal(d.source, 'ai');
  assert.equal(d.action, 'record');
});
