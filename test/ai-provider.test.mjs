// 작업 스텝 2 검증: 제공자 계층을 네트워크 없이 시험합니다(가짜 fetch 주입).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/ai/config.mjs';
import { createProvider } from '../src/ai/provider.mjs';
import { extractJson } from '../src/ai/json.mjs';
import { createClaudeProvider } from '../src/ai/providers/claude.mjs';
import { createLocalProvider } from '../src/ai/providers/local.mjs';
import { AiError } from '../src/ai/errors.mjs';

// --- 설정 ---
test('loadConfig: claude 기본값', () => {
  const c = loadConfig({ AI_PROVIDER: 'claude' });
  assert.equal(c.provider, 'claude');
  assert.equal(c.model, 'claude-sonnet-5-5');
  assert.equal(c.temperature, 0);
  assert.equal(c.maxTokens, 1024);
});

test('loadConfig: AI_MODEL이 제공자 기본값을 덮어씀', () => {
  const c = loadConfig({ AI_PROVIDER: 'claude', AI_MODEL: 'claude-opus-5-5' });
  assert.equal(c.model, 'claude-opus-5-5');
});

test('loadConfig: local 기본값', () => {
  const c = loadConfig({ AI_PROVIDER: 'local' });
  assert.equal(c.provider, 'local');
  assert.equal(c.baseUrl, 'http://127.0.0.1:11434');
  assert.equal(c.model, 'qwen2.5:7b');
});

test('loadConfig: 알 수 없는 제공자는 config 오류', () => {
  assert.throws(() => loadConfig({ AI_PROVIDER: 'foo' }), (e) => e instanceof AiError && e.kind === 'config');
});

// --- JSON 추출 ---
test('extractJson: 코드펜스·앞말이 섞여도 추출', () => {
  const obj = extractJson('설명입니다.\n```json\n{"action":"block","confidence":0.9,"reason":"x"}\n```');
  assert.equal(obj.action, 'block');
  assert.equal(obj.confidence, 0.9);
});

test('extractJson: 중첩 객체와 문자열 속 중괄호', () => {
  const obj = extractJson('{"a":{"b":1},"c":"}"}');
  assert.deepEqual(obj, { a: { b: 1 }, c: '}' });
});

test('extractJson: JSON이 없으면 format 오류', () => {
  assert.throws(() => extractJson('no json here'), (e) => e instanceof AiError && e.kind === 'format');
});

// --- mock 제공자(네트워크 없음) ---
test('mock 제공자: JSON 왕복', async () => {
  const p = createProvider({ provider: 'mock' });
  const out = await p.generate({ user: 'hi' });
  assert.equal(out.provider, 'mock');
  const obj = extractJson(out.text);
  assert.ok(['block', 'alert', 'record'].includes(obj.action));
});

test('mock 제공자: responder 주입', async () => {
  const p = createProvider({ provider: 'mock', mock: { responder: (req) => JSON.stringify({ echo: req.user }) } });
  const out = await p.generate({ user: 'ping' });
  assert.equal(extractJson(out.text).echo, 'ping');
  assert.equal(p.state.calls, 1);
});

// --- claude 제공자(가짜 fetch) ---
test('claude 제공자: 키 없으면 config 오류', async () => {
  const p = createClaudeProvider({ model: 'claude-sonnet-5-5', apiKey: '' });
  await assert.rejects(() => p.generate({ user: 'x' }), (e) => e instanceof AiError && e.kind === 'config');
});

test('claude 제공자: 요청을 올바르게 구성', async () => {
  let captured;
  const fakeFetch = async (url, opts) => {
    captured = { url, opts };
    return {
      ok: true,
      status: 200,
      async json() {
        return { content: [{ type: 'text', text: '{"action":"alert","confidence":0.5,"reason":"ok"}' }], usage: { input_tokens: 10 } };
      },
      async text() { return ''; },
    };
  };
  const p = createClaudeProvider({ model: 'claude-sonnet-5-5', apiKey: 'sk-test', fetchImpl: fakeFetch, maxTokens: 256, temperature: 0, timeoutMs: 1000 });
  const out = await p.generate({ system: 'sys', user: 'u' });
  assert.equal(captured.opts.method, 'POST');
  assert.equal(captured.opts.headers['x-api-key'], 'sk-test');
  assert.equal(captured.opts.headers['anthropic-version'], '2023-06-01');
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.model, 'claude-sonnet-5-5');
  assert.equal(body.system, 'sys');
  assert.equal(body.max_tokens, 256);
  assert.equal(body.messages[0].content, 'u');
  assert.equal(extractJson(out.text).action, 'alert');
});

test('claude 제공자: 비200 응답은 http 오류', async () => {
  const fakeFetch = async () => ({ ok: false, status: 429, async text() { return 'rate limited'; }, async json() { return {}; } });
  const p = createClaudeProvider({ model: 'm', apiKey: 'k', fetchImpl: fakeFetch });
  await assert.rejects(() => p.generate({ user: 'x' }), (e) => e instanceof AiError && e.kind === 'http' && e.status === 429 && e.aiFailure === true);
});

// --- local 제공자(가짜 fetch) ---
test('local 제공자: Ollama 요청 구성', async () => {
  let captured;
  const fakeFetch = async (url, opts) => {
    captured = { url, opts };
    return {
      ok: true,
      status: 200,
      async json() { return { message: { content: '{"action":"record","confidence":0,"reason":"r"}' }, eval_count: 5 }; },
      async text() { return ''; },
    };
  };
  const p = createLocalProvider({ model: 'qwen2.5:7b', baseUrl: 'http://127.0.0.1:11434/', fetchImpl: fakeFetch });
  const out = await p.generate({ user: 'u', responseFormat: 'json' });
  assert.ok(captured.url.endsWith('/api/chat'));
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.model, 'qwen2.5:7b');
  assert.equal(body.format, 'json');
  assert.equal(body.stream, false);
  assert.equal(extractJson(out.text).action, 'record');
});

test('local 제공자: 네트워크 실패는 network 오류', async () => {
  const fakeFetch = async () => { throw new Error('ECONNREFUSED'); };
  const p = createLocalProvider({ model: 'm', baseUrl: 'http://127.0.0.1:11434', fetchImpl: fakeFetch });
  await assert.rejects(() => p.generate({ user: 'x' }), (e) => e instanceof AiError && e.kind === 'network');
});
