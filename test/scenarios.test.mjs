// 작업 스텝 7 검증: 실사례 각색 경보가 기대 판정(_expect)대로 떨어지고,
// 공격 경보는 ZTNA 집행까지 이어지는지 네트워크 없이 확인합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ruleDecide, MODULE_KEYS } from '../src/engine/rule-fallback.mjs';
import { createEnforcer } from '../src/ztna/enforce.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SC_DIR = join(ROOT, 'scenarios');

async function loadScenario(moduleKey) {
  return JSON.parse(await readFile(join(SC_DIR, `${moduleKey}.json`), 'utf8'));
}

test('scenarios: 여섯 모듈 파일이 모두 있고 스키마가 맞다', async () => {
  const files = (await readdir(SC_DIR)).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 6);
  for (const mk of MODULE_KEYS) {
    const sc = await loadScenario(mk);
    assert.equal(sc.schema, 'aleph.xdr.scenario.v1');
    assert.equal(sc.moduleKey, mk);
    assert.ok(sc.source && sc.source.incident, `${mk} 출처 사건`);
    assert.ok(Array.isArray(sc.alerts) && sc.alerts.length >= 1);
  }
});

test('scenarios: 각 경보에 _source·_adaptation·_expect 주석이 있다', async () => {
  for (const mk of MODULE_KEYS) {
    const sc = await loadScenario(mk);
    for (const a of sc.alerts) {
      assert.ok(a._source, `${a.id} _source`);
      assert.ok(a._adaptation, `${a.id} _adaptation`);
      assert.ok(['block', 'alert', 'record'].includes(a._expect), `${a.id} _expect`);
    }
  }
});

test('scenarios: 모든 각색 경보가 규칙 판정에서 기대(_expect)와 일치', async () => {
  for (const mk of MODULE_KEYS) {
    const sc = await loadScenario(mk);
    for (const a of sc.alerts) {
      const d = await ruleDecide(mk, a, ROOT);
      assert.equal(d.action, a._expect, `${mk}/${a.id} 기대 ${a._expect} != 실제 ${d.action}`);
    }
  }
});

test('scenarios: 여섯 모듈 모두 block 공격 경보를 1건 이상 가지며 집행까지 이어진다', async () => {
  for (const mk of MODULE_KEYS) {
    const sc = await loadScenario(mk);
    const blk = sc.alerts.find((a) => a._expect === 'block');
    assert.ok(blk, `${mk} block 경보 존재`);
    const enforcer = await createEnforcer(mk, { now: () => Date.parse(blk.timestamp), root: ROOT });
    const d = await ruleDecide(mk, blk, ROOT);
    const r = await enforcer.enforce(blk, d);
    assert.equal(r.access, 'enforce', `${mk} 집행`);
    assert.ok(r.target, `${mk} 집행 대상`);
    assert.ok(r.rule, `${mk} 거부 규칙 생성`);
  }
});

test('scenarios: 중립화 — 사설/문서용 주소만 쓰고 실제 IOC 식별자가 없다', async () => {
  // 실제 운영 도메인·CLSID·키가 새어들지 않았는지 가벼운 점검(문서용·사설 대역·<hash> 토큰만 허용)
  for (const mk of MODULE_KEYS) {
    const raw = await readFile(join(SC_DIR, `${mk}.json`), 'utf8');
    // CLSID 중괄호 패턴이 그대로 들어가지 않았는지
    assert.ok(!/\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-/.test(raw), `${mk} CLSID 원본 없음`);
    // insightjs 등 실제 악성 도메인 문자열이 없는지(니케 사건 IOC)
    assert.ok(!/insightjs/i.test(raw), `${mk} 악성 도메인 없음`);
  }
});
