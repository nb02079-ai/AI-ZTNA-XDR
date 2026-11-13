// AI 설명 생성기: 판정된 경보에 대해 "지금 그 경보"의 설명을 만들고, 근거를 대조해 검증합니다.
// 18단계 계약을 이 저장소의 fixture 구조로 옮긴 것입니다.
//   - AI는 설명과 함께 alertId(설명 대상 경보 id)와 evidence(인용한 패턴 이름들)를 돌려줍니다.
//   - alertId가 경보 id와 다르거나, 인용 근거가 patterns에 없거나 비었거나 중복이면,
//     설명 내용을 숨기고(ok:false) 이유만 남깁니다(= 성공 표시 안 붙임).
import { extractJson } from '../ai/json.mjs';
import { AiError } from '../ai/errors.mjs';
import { loadPatterns, summarizePatterns } from './patterns.mjs';

const EXPLAIN_SYSTEM = [
  '너는 보안 분석가다. 이미 분류된 경보 하나에 대해, 왜 그렇게 판정했는지 짧은 한국어 설명을 쓴다.',
  '설명은 주어진 "경보"와 "패턴 근거"에만 기댄다. 바깥 사실을 지어내지 않는다.',
  '반드시 지금 받은 경보(그 id)에 대한 설명만 쓴다. 다른 사건을 설명하지 않는다.',
  'evidence에는 설명에 실제로 사용한 패턴의 name만, 주어진 패턴 목록에서 골라 1개 이상 적는다. 지어내지 않는다.',
  '',
  '출력은 JSON 객체 하나만. 설명·코드펜스 없이 아래 형식 그대로.',
  '{"alertId":"경보 id","explanation":"2~3문장 한국어 설명","evidence":["패턴 name", ...]}',
].join('\n');

function buildExplainPrompt({ alert, decision, patterns }) {
  const patternList = (patterns.items ?? [])
    .map((p, i) => `${i + 1}. ${p.name}${p.technique ? ` [${p.technique}]` : ''} — ${p.evidence}`)
    .join('\n');
  const user = [
    `경보 id: ${alert.id ?? '(없음)'}`,
    `판정: ${decision.action} (confidence ${decision.confidence})`,
    `판정 이유: ${decision.reason ?? ''}`,
    '',
    '패턴 근거(여기 있는 name만 evidence로 쓸 수 있다):',
    patternList || '(패턴 없음)',
    '',
    '경보(JSON):',
    JSON.stringify(alert, null, 2),
    '',
    `위 경보(id: ${alert.id ?? ''})에 대한 설명을 JSON 한 개로 출력하라.`,
  ].join('\n');
  return { system: EXPLAIN_SYSTEM, user };
}

/** AI 설명 객체를 경보·패턴과 대조해 받아들일지 판별합니다. */
export function verifyExplanation({ parsed, alert, patterns }) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, code: 'bad_format', reason: '설명이 객체 형식이 아닙니다' };
  }
  const explanation = typeof parsed.explanation === 'string' ? parsed.explanation.trim() : '';
  if (!explanation) {
    return { ok: false, code: 'empty_explanation', reason: '설명 내용이 비었습니다' };
  }
  // 1) 대상 경보 대조: alertId가 지금 경보 id와 같아야 한다.
  const alertId = alert?.id != null ? String(alert.id) : '';
  const claimedId = parsed.alertId != null ? String(parsed.alertId).trim() : '';
  if (!alertId || !claimedId || claimedId !== alertId) {
    return { ok: false, code: 'wrong_event_rejected', reason: `설명이 현재 경보(${alertId || '?'})의 것인지 확인되지 않습니다` };
  }
  // 2) 근거 대조: 비었거나·중복·목록에 없는 이름이면 거부.
  const known = new Set((patterns.items ?? []).map((p) => p.name).filter(Boolean));
  const raw = Array.isArray(parsed.evidence) ? parsed.evidence.map((e) => String(e).trim()).filter(Boolean) : [];
  if (raw.length === 0) {
    return { ok: false, code: 'empty_evidence', reason: '인용한 근거가 없습니다' };
  }
  if (new Set(raw).size !== raw.length) {
    return { ok: false, code: 'duplicate_evidence', reason: '인용 근거에 중복이 있습니다' };
  }
  const unknown = raw.filter((e) => !known.has(e));
  if (unknown.length > 0) {
    return { ok: false, code: 'unknown_evidence', reason: `패턴에 없는 근거가 섞였습니다: ${unknown.join(', ')}` };
  }
  return { ok: true, explanation, evidence: raw, alertId };
}

/**
 * 경보 하나의 설명을 만듭니다. 검증을 통과하면 ok:true로 내용을, 아니면 ok:false로 이유만 돌려줍니다.
 * @returns {Promise<{ok:boolean, explanation?:string, evidence?:string[], alertId?:string, code?:string, reason:string, source:'ai'|'none', fallback:(null|{kind:string,message:string})}>}
 */
export async function explainAlert({ moduleKey, alert, decision, provider, config = {}, root }) {
  const patterns = summarizePatterns(await loadPatterns(moduleKey, root));
  const { system, user } = buildExplainPrompt({ alert, decision, patterns });

  let fallback = null;
  try {
    const res = await provider.generate({
      system,
      user,
      responseFormat: 'json',
      maxTokens: config.maxTokens ?? 512,
      temperature: config.temperature, // undefined면 제공자가 요청에 넣지 않음(Sonnet 5.5 호환)
      timeoutMs: config.timeoutMs,
    });
    const parsed = extractJson(res.text);
    const verdict = verifyExplanation({ parsed, alert, patterns });
    if (verdict.ok) {
      return { ...verdict, source: 'ai', fallback: null };
    }
    // 검증 실패: 내용을 숨기고 이유만 — 성공 표시를 붙이지 않는다.
    return { ok: false, code: verdict.code, reason: verdict.reason, source: 'ai', fallback: null };
  } catch (error) {
    if (error instanceof AiError) {
      fallback = { kind: error.kind, message: error.message };
    } else {
      fallback = { kind: 'unknown', message: error && error.message ? error.message : String(error) };
    }
    // 호출 자체가 실패하면 설명 없음(내용 숨김) + 사유.
    return { ok: false, code: 'ai_unavailable', reason: `설명을 생성하지 못했습니다: ${fallback.message}`, source: 'none', fallback };
  }
}
