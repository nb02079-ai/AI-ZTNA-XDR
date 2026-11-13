#!/usr/bin/env node
// AI 연결 점검기: 설정된 제공자에 1회만 호출해, 되는지/안 되는지와 그 이유를 그대로 보여줍니다.
// 파이프라인은 실패를 규칙 폴백으로 조용히 삼키므로, "왜 AI가 안 쓰였는지"는 이 도구로 확인합니다.
//
// 사용:
//   node --env-file=.env scripts/check-ai.mjs
//   AI_PROVIDER=mock node scripts/check-ai.mjs   (키 없이 통로만 확인)
import process from 'node:process';
import { loadConfig } from '../src/ai/config.mjs';
import { createProvider } from '../src/ai/provider.mjs';
import { extractJson } from '../src/ai/json.mjs';
import { AiError } from '../src/ai/errors.mjs';

function line(s = '') { process.stdout.write(`${s}\n`); }

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    line(`✗ 설정 오류: ${error.message}`);
    process.exitCode = 2;
    return;
  }

  line(`제공자: ${config.provider}`);
  line(`모델:   ${config.model}`);

  // claude 제공자는 키가 있어야 한다. 없으면 호출 전에 바로 알린다.
  if (config.provider === 'claude') {
    if (!config.apiKey) {
      line('✗ ANTHROPIC_API_KEY 가 비어 있습니다. .env 에 키(sk-ant-...)를 넣고 --env-file=.env 로 실행하세요.');
      line('  참고: $env:AI_PROVIDER 같은 세션 환경변수가 .env 보다 우선합니다. 남아 있으면 Remove-Item Env:\\AI_PROVIDER 로 지우세요.');
      process.exitCode = 1;
      return;
    }
    line(`키:     설정됨 (…${config.apiKey.slice(-4)})`);
    if (!config.apiKey.startsWith('sk-ant-')) {
      line('  주의: 키가 sk-ant- 로 시작하지 않습니다. 올바른 Anthropic 키인지 확인하세요.');
    }
  }
  if (config.provider === 'local') {
    line(`엔드포인트: ${config.baseUrl}`);
  }

  line('');
  line('호출 시도 중…');
  const start = Date.now();
  try {
    const res = await provider_generate(config);
    const ms = Date.now() - start;
    line(`✓ 성공 (${ms}ms)`);
    // 응답이 JSON이면 파싱해 한 줄로, 아니면 앞부분만 보여준다.
    let shown = res.text.slice(0, 200);
    try { shown = JSON.stringify(extractJson(res.text)); } catch { /* 평문 그대로 */ }
    line(`  응답: ${shown}`);
    if (res.usage) line(`  토큰: ${JSON.stringify(res.usage)}`);
    line('');
    line('→ 연결이 정상입니다. scripts/run.mjs · scripts/report-run.mjs 를 실제 AI로 돌릴 수 있습니다.');
  } catch (error) {
    const ms = Date.now() - start;
    line(`✗ 실패 (${ms}ms)`);
    if (error instanceof AiError) {
      line(`  종류: ${error.kind}${error.status ? ` (HTTP ${error.status})` : ''}`);
      line(`  메시지: ${error.message}`);
      if (error.cause && error.cause.message) line(`  상세: ${String(error.cause.message).slice(0, 400)}`);
      line('');
      line(hint(error));
    } else {
      line(`  ${error && error.stack ? error.stack : error}`);
    }
    process.exitCode = 1;
  }
}

function provider_generate(config) {
  const provider = createProvider(config);
  return provider.generate({
    system: '너는 점검용 응답기다. 다른 말 없이 아래 JSON 한 개만 출력한다.',
    user: '{"ok":true} 만 출력하라.',
    responseFormat: 'json',
    maxTokens: 64,
    temperature: config.temperature, // config에 명시됐을 때만 전송(undefined면 안 보냄)
  });
}

function hint(error) {
  switch (error.kind) {
    case 'config':
      return '→ 설정 문제입니다. 키·제공자·모델을 확인하세요.';
    case 'http':
      if (error.status === 401) return '→ 인증 실패(401): 키가 틀렸거나 비활성입니다. 콘솔에서 키를 확인·재발급하세요.';
      if (error.status === 403) return '→ 권한 없음(403): 크레딧 잔액이나 조직 권한을 확인하세요.';
      if (error.status === 404) return '→ 모델을 찾을 수 없음(404): CLAUDE_MODEL 값이 맞는지 확인하세요(claude-sonnet-5-5).';
      if (error.status === 429) return '→ 요청 과다(429): 잠시 뒤 다시 시도하세요.';
      return '→ 서버가 오류를 돌려줬습니다. 위 상세를 확인하세요.';
    case 'timeout':
      return '→ 시간 초과: 네트워크가 느리거나 막혔습니다. .env의 AI_TIMEOUT_MS를 늘리거나 방화벽을 확인하세요.';
    case 'network':
      return '→ 네트워크 연결 실패: 방화벽·프록시가 api.anthropic.com(또는 로컬 엔드포인트)을 막는지 확인하세요.';
    case 'format':
      return '→ 응답을 해석하지 못했습니다. 다른 모델이거나 응답이 비정상입니다.';
    default:
      return '→ 원인을 특정하지 못했습니다. 위 메시지를 확인하세요.';
  }
}

main().catch((error) => {
  process.stderr.write(`점검기 자체 오류: ${error && error.stack ? error.stack : error}\n`);
  process.exitCode = 1;
});
