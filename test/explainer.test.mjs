// 작업 스텝 4 검증: AI 설명 생성기와 근거 대조를 네트워크 없이 시험합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { explainAlert, verifyExplanation } from '../src/engine/explainer.mjs';
import { loadPatterns, summarizePatterns } from '../src/engine/patterns.mjs';
import { createMockProvider } from '../src/ai/providers/mock.mjs';
import { AiError } from '../src/ai/errors.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

async function firstAlert(moduleKey) {
  const f = JSON.parse(await readFile(join(ROOT, 'aleph-source', 'fixtures', `${moduleKey}.json`), 'utf8'));
  return f.alerts[0];
}
const DECISION = { action: 'block', confidence: 0.9, reason: '테스트 판정' };

// --- verifyExplanation 단위 ---
test('verifyExplanation: 정상 설명 통과', async () => {
  const patterns = summarizePatterns(await loadPatterns('persistence', ROOT));
  const alert = await firstAlert('persistence');
  const v = verifyExplanation({
    parsed: { alertId: alert.id, explanation: '임시 폴더 실행 파일을 가리키는 새 서비스라 지속성으로 판정했습니다.', evidence: ['service_unsigned_new_or_changed'] },
    alert, patterns,
  });
  assert.equal(v.ok, true);
  assert.deepEqual(v.evidence, ['service_unsigned_new_or_changed']);
});

test('verifyExplanation: 다른 경보 id는 wrong_event_rejected', async () => {
  const patterns = summarizePatterns(await loadPatterns('persistence', ROOT));
  const alert = await firstAlert('persistence');
  const v = verifyExplanation({
    parsed: { alertId: 'ps-99', explanation: 'x', evidence: ['service_unsigned_new_or_changed'] },
    alert, patterns,
  });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'wrong_event_rejected');
});

test('verifyExplanation: 빈 설명 거부', async () => {
  const patterns = summarizePatterns(await loadPatterns('persistence', ROOT));
  const alert = await firstAlert('persistence');
  const v = verifyExplanation({ parsed: { alertId: alert.id, explanation: '   ', evidence: ['service_unsigned_new_or_changed'] }, alert, patterns });
  assert.equal(v.code, 'empty_explanation');
});

test('verifyExplanation: 빈 근거 거부', async () => {
  const patterns = summarizePatterns(await loadPatterns('persistence', ROOT));
  const alert = await firstAlert('persistence');
  const v = verifyExplanation({ parsed: { alertId: alert.id, explanation: '설명', evidence: [] }, alert, patterns });
  assert.equal(v.code, 'empty_evidence');
});

test('verifyExplanation: 중복 근거 거부', async () => {
  const patterns = summarizePatterns(await loadPatterns('persistence', ROOT));
  const alert = await firstAlert('persistence');
  const v = verifyExplanation({ parsed: { alertId: alert.id, explanation: '설명', evidence: ['service_unsigned_new_or_changed', 'service_unsigned_new_or_changed'] }, alert, patterns });
  assert.equal(v.code, 'duplicate_evidence');
});

test('verifyExplanation: 목록에 없는 근거 거부', async () => {
  const patterns = summarizePatterns(await loadPatterns('persistence', ROOT));
  const alert = await firstAlert('persistence');
  const v = verifyExplanation({ parsed: { alertId: alert.id, explanation: '설명', evidence: ['made_up_pattern'] }, alert, patterns });
  assert.equal(v.code, 'unknown_evidence');
});

// --- explainAlert 통합(mock) ---
test('explainAlert: 올바른 AI 설명이면 ok:true', async () => {
  const alert = await firstAlert('persistence');
  const provider = createMockProvider({ mock: { text: JSON.stringify({ alertId: alert.id, explanation: '새 서명 없는 서비스가 임시 폴더 실행 파일을 가리켜 지속성으로 판정했습니다.', evidence: ['service_unsigned_new_or_changed'] }) } });
  const r = await explainAlert({ moduleKey: 'persistence', alert, decision: DECISION, provider, root: ROOT });
  assert.equal(r.ok, true);
  assert.equal(r.source, 'ai');
  assert.ok(r.explanation.length > 0);
});

test('explainAlert: 엉뚱한 경보 설명은 내용 숨기고 이유만', async () => {
  const alert = await firstAlert('persistence');
  const provider = createMockProvider({ mock: { text: JSON.stringify({ alertId: 'ps-99', explanation: '다른 사건 설명', evidence: ['service_unsigned_new_or_changed'] }) } });
  const r = await explainAlert({ moduleKey: 'persistence', alert, decision: DECISION, provider, root: ROOT });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'wrong_event_rejected');
  assert.equal(r.explanation, undefined); // 내용 숨김
});

test('explainAlert: 지어낸 근거는 거부(내용 숨김)', async () => {
  const alert = await firstAlert('persistence');
  const provider = createMockProvider({ mock: { text: JSON.stringify({ alertId: alert.id, explanation: '설명', evidence: ['invented'] }) } });
  const r = await explainAlert({ moduleKey: 'persistence', alert, decision: DECISION, provider, root: ROOT });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'unknown_evidence');
});

test('explainAlert: 깨진 JSON이면 bad_format', async () => {
  const alert = await firstAlert('brute-force');
  const provider = createMockProvider({ mock: { text: '설명을 드리자면...' } });
  const r = await explainAlert({ moduleKey: 'brute-force', alert, decision: DECISION, provider, root: ROOT });
  assert.equal(r.ok, false);
  // extractJson이 던지므로 ai_unavailable(format kind)로 떨어진다
  assert.ok(['bad_format', 'ai_unavailable'].includes(r.code));
});

test('explainAlert: AI 호출 실패는 ai_unavailable + source none', async () => {
  const alert = await firstAlert('exfiltration');
  const provider = { name: 'boom', async generate() { throw new AiError('끊김', { kind: 'network' }); } };
  const r = await explainAlert({ moduleKey: 'exfiltration', alert, decision: DECISION, provider, root: ROOT });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ai_unavailable');
  assert.equal(r.source, 'none');
  assert.equal(r.fallback.kind, 'network');
});
