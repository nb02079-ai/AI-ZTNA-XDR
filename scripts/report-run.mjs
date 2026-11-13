#!/usr/bin/env node
// 보고서용 실행기: scenarios/ 각색 경보를 파이프라인에 넣어 판정·설명·집행 결과를 모으고,
// 기대 판정(_expect)과 대조해 결과 JSON을 out/report-<provider>.json 에 저장합니다.
//
// 사용:
//   node --env-file=.env scripts/report-run.mjs            # 실제 제공자(.env의 AI_PROVIDER)
//   AI_PROVIDER=mock node scripts/report-run.mjs           # 키 없이 구조 확인(설명은 mock이라 거부됨)
//
// 저장된 JSON을 docs/DETECTION_REPORT.md의 표에 옮겨 적습니다.
import process from 'node:process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/ai/config.mjs';
import { createProvider } from '../src/ai/provider.mjs';
import { runModule } from '../src/engine/pipeline.mjs';
import { MODULE_KEYS } from '../src/engine/rule-fallback.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

async function loadScenario(moduleKey) {
  return JSON.parse(await readFile(join(ROOT, 'scenarios', `${moduleKey}.json`), 'utf8'));
}

function classify(expect, action) {
  // 탐지 관점: block/alert는 '대응 대상', record는 '통과'.
  const flagged = (x) => x === 'block' || x === 'alert';
  if (flagged(expect) && action === expect) return 'hit';          // 기대대로 잡음
  if (flagged(expect) && action === 'record') return 'miss';       // 놓침
  if (expect === 'record' && action === 'record') return 'clean';  // 정상 통과
  if (expect === 'record' && flagged(action)) return 'false_positive'; // 오탐
  if (flagged(expect) && flagged(action)) return 'partial';        // 잡았으나 등급 다름
  return 'other';
}

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    process.stderr.write(`설정 오류: ${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  const provider = createProvider(config);

  const report = {
    generatedAt: new Date().toISOString(),
    provider: config.provider,
    model: config.model,
    modules: [],
    totals: { hit: 0, miss: 0, clean: 0, false_positive: 0, partial: 0, other: 0, aiUsed: 0, aiFallback: 0 },
  };

  for (const moduleKey of MODULE_KEYS) {
    const sc = await loadScenario(moduleKey);
    const expectById = new Map(sc.alerts.map((a) => [a.id, a._expect]));
    const { rows } = await runModule({ moduleKey, provider, config, root: ROOT, alerts: sc.alerts });

    const items = rows.map((row) => {
      const expect = expectById.get(row.alertId) ?? 'record';
      const verdict = classify(expect, row.decision.action);
      report.totals[verdict] += 1;
      if (row.decision.source === 'rule') report.totals.aiFallback += 1;
      else report.totals.aiUsed += 1;
      return {
        alertId: row.alertId,
        expect,
        action: row.decision.action,
        confidence: row.decision.confidence,
        source: row.decision.source,          // ai | rule(폴백)
        fallbackKind: row.decision.fallback ? row.decision.fallback.kind : null,     // 폴백이면 그 사유
        fallbackMessage: row.decision.fallback ? row.decision.fallback.message : null,
        verdict,                               // hit | miss | clean | false_positive | partial
        access: row.enforcement.access,        // enforce | review | allow
        enforceKind: row.enforcement.kind,
        target: row.enforcement.target,
        explained: Boolean(row.explanation && row.explanation.ok),
        explanationCode: row.explanation && !row.explanation.ok ? row.explanation.code : null,
        explanation: row.explanation && row.explanation.ok ? row.explanation.explanation : null,
        reason: row.decision.reason,
      };
    });
    report.modules.push({ module: moduleKey, source: sc.source, items });
  }

  const outDir = join(ROOT, 'out');
  await mkdir(outDir, { recursive: true });
  const outFile = join(outDir, `report-${config.provider}.json`);
  await writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  // 콘솔 요약
  process.stdout.write(`제공자 ${report.provider} / 모델 ${report.model}\n`);
  process.stdout.write(`집계: 잡음(hit) ${report.totals.hit}, 놓침(miss) ${report.totals.miss}, 정상통과(clean) ${report.totals.clean}, 오탐(fp) ${report.totals.false_positive}, 부분 ${report.totals.partial}\n`);
  process.stdout.write(`판정출처: 실제 AI ${report.totals.aiUsed}, 규칙 폴백 ${report.totals.aiFallback}\n`);
  if (report.totals.aiFallback > 0) {
    // 폴백 사유 분포를 모아 보여준다 — "왜 AI가 안 쓰였는지"가 한눈에 보이게.
    const kinds = {};
    for (const m of report.modules) for (const it of m.items) {
      if (it.source === 'rule' && it.fallbackKind) kinds[it.fallbackKind] = (kinds[it.fallbackKind] ?? 0) + 1;
    }
    const detail = Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(', ');
    process.stdout.write(`폴백 사유: ${detail || '(미상)'} — 연결 점검은 scripts/check-ai.mjs 로 확인하세요.\n`);
  }
  for (const m of report.modules) {
    for (const it of m.items) {
      const ex = it.explained ? '설명O' : (it.explanationCode ? `설명X(${it.explanationCode})` : '설명-');
      const fb = it.source === 'rule' && it.fallbackKind ? ` 폴백(${it.fallbackKind})` : '';
      process.stdout.write(`  ${m.module.padEnd(14)} ${it.alertId.padEnd(9)} 기대 ${it.expect.padEnd(6)} → ${it.action.padEnd(6)} [${it.verdict}] ${it.source}${fb} ${it.access} ${ex}\n`);
    }
  }
  process.stdout.write(`\n저장: ${outFile}\n`);
}

main().catch((error) => {
  process.stderr.write(`실행 실패: ${error && error.stack ? error.stack : error}\n`);
  process.exitCode = 1;
});
