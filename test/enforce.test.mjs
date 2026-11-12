// 작업 스텝 5 검증: 판정 → ZTNA 접근 결정 매핑을 네트워크 없이 시험합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createEnforcer, ENFORCEMENT, loadRespond } from '../src/ztna/enforce.mjs';
import { MODULE_KEYS } from '../src/engine/rule-fallback.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const LOG = join(tmpdir(), 'ai-ztna-xdr-test.alerts.log');

async function firstAlert(moduleKey) {
  const f = JSON.parse(await readFile(join(ROOT, 'aleph-source', 'fixtures', `${moduleKey}.json`), 'utf8'));
  return f.alerts[0];
}
const BLOCK = { action: 'block', confidence: 0.95, reason: '명확한 공격' };
const ALERT = { action: 'alert', confidence: 0.5, reason: '애매함' };
const RECORD = { action: 'record', confidence: 0.1, reason: '정상' };

// --- 집행 메타가 여섯 모듈에 모두 정의됐는가 ---
test('ENFORCEMENT: 여섯 모듈 모두 집행 성격 정의', () => {
  for (const m of MODULE_KEYS) {
    assert.ok(ENFORCEMENT[m], `${m} 집행 메타`);
    assert.ok(['deny_source', 'isolate_host', 'revoke_session', 'block_destination'].includes(ENFORCEMENT[m].kind));
  }
});

// --- record → allow, alert → review (막지 않음) ---
test('record 판정은 allow(허용)', async () => {
  const e = await createEnforcer('brute-force', { now: () => 0, logFile: LOG, root: ROOT });
  const r = await e.enforce(await firstAlert('brute-force'), RECORD);
  assert.equal(r.access, 'allow');
  assert.equal(r.rule, null);
});

test('alert 판정은 review(사람 확인)', async () => {
  const e = await createEnforcer('brute-force', { now: () => 0, logFile: LOG, root: ROOT });
  const r = await e.enforce(await firstAlert('brute-force'), ALERT);
  assert.equal(r.access, 'review');
  assert.equal(r.rule, null);
});

// --- block → enforce, 집행 단위가 모듈 성격과 맞는가 ---
test('brute-force block → 출발 주소 거부', async () => {
  const e = await createEnforcer('brute-force', { now: () => 0, logFile: LOG, root: ROOT });
  const alert = await firstAlert('brute-force');
  const r = await e.enforce(alert, BLOCK);
  assert.equal(r.access, 'enforce');
  assert.equal(r.kind, 'deny_source');
  assert.equal(r.target, alert.data.srcip);
  assert.ok(r.rule && r.rule.address === alert.data.srcip);
});

test('persistence block → 호스트 격리', async () => {
  const e = await createEnforcer('persistence', { now: () => 0, logFile: LOG, root: ROOT });
  const alert = await firstAlert('persistence');
  const r = await e.enforce(alert, BLOCK);
  assert.equal(r.access, 'enforce');
  assert.equal(r.kind, 'isolate_host');
  assert.equal(r.target, alert.data.srcip);
});

test('privilege block → 계정 세션 거둠(계정 단위)', async () => {
  const e = await createEnforcer('privilege', { now: () => 0, logFile: LOG, root: ROOT });
  const alert = await firstAlert('privilege');
  const r = await e.enforce(alert, BLOCK);
  assert.equal(r.kind, 'revoke_session');
  assert.equal(r.target, alert.data.srcuser); // 주소가 아니라 계정
});

test('exfiltration block → 목적지 차단(dstip 단위)', async () => {
  const e = await createEnforcer('exfiltration', { now: () => 0, logFile: LOG, root: ROOT });
  const alert = await firstAlert('exfiltration');
  const r = await e.enforce(alert, BLOCK);
  assert.equal(r.kind, 'block_destination');
  assert.equal(r.target, alert.data.dstip);
});

// --- 안전장치 재사용: 내부망 주소는 막지 않는다(출발 주소 모듈) ---
test('내부망 출발 주소는 enforce되지 않고 review로', async () => {
  const e = await createEnforcer('brute-force', { now: () => 0, logFile: LOG, root: ROOT });
  const alert = { id: 'bf-internal', timestamp: '2026-09-27T09:00:00+09:00', agent: { name: 'x' },
    rule: { level: 12, description: '내부 주소 실패 반복' }, data: { srcip: '192.168.0.5', srcuser: 'u' } };
  const r = await e.enforce(alert, BLOCK);
  assert.equal(r.access, 'review'); // 거부 규칙에 들어가지 않음
  assert.equal(r.skipped, 'internal_address');
});

// --- 중복: 같은 주소 두 번째 block은 거부 규칙에 중복으로 안 들어감 ---
test('같은 주소 중복 block은 두 번째가 skip', async () => {
  const e = await createEnforcer('known-cve', { now: () => 0, logFile: LOG, root: ROOT });
  const alert = await firstAlert('known-cve');
  const r1 = await e.enforce(alert, BLOCK);
  const r2 = await e.enforce({ ...alert, id: 'kc-dup' }, BLOCK);
  assert.equal(r1.access, 'enforce');
  assert.equal(r2.access, 'review');
  assert.equal(r2.skipped, 'duplicate');
});

// --- 활성 규칙 목록 ---
test('denyList.active로 활성 규칙을 모은다', async () => {
  const e = await createEnforcer('web-injection', { now: () => 0, logFile: LOG, root: ROOT });
  await e.enforce(await firstAlert('web-injection'), BLOCK);
  const active = e.denyList.active();
  assert.ok(Array.isArray(active) && active.length === 1);
});
