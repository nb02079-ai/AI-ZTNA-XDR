#!/usr/bin/env node
// 실행기: 한 모듈(또는 all)의 fixture를 판정 → 설명 → 집행까지 흘려보내고 요약을 출력합니다.
// 사용:
//   node --env-file=.env scripts/run.mjs <모듈|all> [--json] [--rows]
//   AI_PROVIDER=mock node scripts/run.mjs known-cve   (키 없이 흐름만 확인)
import process from 'node:process';
import { loadConfig } from '../src/ai/config.mjs';
import { createProvider } from '../src/ai/provider.mjs';
import { runModule } from '../src/engine/pipeline.mjs';
import { MODULE_KEYS } from '../src/engine/rule-fallback.mjs';

function parseArgs(argv) {
  const args = { module: null, json: false, rows: false };
  for (const a of argv) {
    if (a === '--json') args.json = true;
    else if (a === '--rows') args.rows = true;
    else if (!a.startsWith('--') && !args.module) args.module = a;
  }
  return args;
}

function printSummary(s) {
  const line = (label, obj) => `  ${label}: ${Object.entries(obj).map(([k, v]) => `${k} ${v}`).join(', ')}`;
  process.stdout.write(`[${s.module}] 경보 ${s.total}건\n`);
  process.stdout.write(`${line('판정', s.decision)}\n`);
  process.stdout.write(`${line('판정출처', s.source)}\n`);
  process.stdout.write(`${line('접근', s.access)}\n`);
  process.stdout.write(`  설명 성공 ${s.explained}, 설명 거부 ${s.explanationRejected}, 거부규칙 ${s.enforcedRules}, 활성규칙 ${s.activeRules}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.module || (args.module !== 'all' && !MODULE_KEYS.includes(args.module))) {
    process.stderr.write(`사용법: node scripts/run.mjs <${MODULE_KEYS.join('|')}|all> [--json] [--rows]\n`);
    process.exitCode = 2;
    return;
  }

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    process.stderr.write(`설정 오류: ${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  const provider = createProvider(config);

  const targets = args.module === 'all' ? MODULE_KEYS : [args.module];
  const results = [];
  for (const moduleKey of targets) {
    const { summary, rows } = await runModule({ moduleKey, provider, config });
    results.push({ summary, rows });
  }

  if (args.json) {
    const payload = args.rows ? results : results.map((r) => r.summary);
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stdout.write(`제공자: ${config.provider} / 모델: ${config.model}\n\n`);
  for (const { summary, rows } of results) {
    printSummary(summary);
    if (args.rows) {
      for (const row of rows) {
        const ex = row.explanation ? (row.explanation.ok ? '설명O' : `설명X(${row.explanation.code})`) : '설명-';
        const src = row.decision.source === 'rule' && row.decision.fallback
          ? `rule(폴백:${row.decision.fallback.kind})`
          : row.decision.source;
        process.stdout.write(`    ${row.alertId}: ${row.decision.action}/${src} → ${row.enforcement.access} [${ex}]\n`);
      }
    }
    process.stdout.write('\n');
  }
}

main().catch((error) => {
  process.stderr.write(`실행 실패: ${error && error.stack ? error.stack : error}\n`);
  process.exitCode = 1;
});
