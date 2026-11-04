// AI 판정기에 넣을 system·user 프롬프트를 만듭니다.
// 판정 기준(block/alert/record)과 근거(patterns)를 주고, 엄격한 JSON 한 개만 돌려받습니다.

const ACTION_RULE = [
  '너는 보안 경보 분류기다. 경보 하나를 아래 세 값 중 하나로 분류한다.',
  '- block: 명확한 공격. 근거가 충분하고 막아야 한다.',
  '- alert: 애매한 시도. 사람이 확인해야 한다.',
  '- record: 정상이거나 근거가 약하다. 기록만 한다.',
  '',
  '판단은 주어진 "패턴 근거"와 경보 내용에만 기댄다. 바깥 지식으로 새 사실을 지어내지 않는다.',
  'confidence는 0 이상 1 이하 숫자다. block은 보통 0.85 이상, alert는 0.5 안팎, record는 낮다.',
  '계정(srcuser)이 있는 정상 활동을 주소만 보고 공격으로 과잉 판정하지 않는다.',
  'reason은 한국어 한 문장으로, 어떤 패턴·근거로 그렇게 판정했는지 짧게 쓴다.',
].join('\n');

const OUTPUT_RULE = [
  '출력은 JSON 객체 하나만. 설명·코드펜스·여는 말 없이 아래 형식 그대로.',
  '{"action":"block|alert|record","confidence":0~1,"reason":"한 문장"}',
].join('\n');

/**
 * @param {{moduleKey:string, alert:any, patterns:{basis:object,items:Array<object>}}} args
 * @returns {{system:string, user:string}}
 */
export function buildDecisionPrompt({ moduleKey, alert, patterns }) {
  const system = `${ACTION_RULE}\n\n${OUTPUT_RULE}`;

  const basisLine = patterns?.basis?.technique
    ? `근거 기법: ${patterns.basis.technique} ${patterns.basis.name ?? ''}`.trim()
    : '근거 기법: (명시 없음)';

  const patternLines = (patterns?.items ?? []).map((p, i) => {
    const tech = p.technique ? ` [${p.technique}]` : '';
    const only = p.alertOnly ? ' (이 패턴만으로는 alert까지)' : '';
    return `${i + 1}. ${p.name}${tech}${only}\n   조건: ${p.condition}\n   근거: ${p.evidence}`;
  }).join('\n');

  const user = [
    `모듈: ${moduleKey}`,
    basisLine,
    '',
    '패턴 근거:',
    patternLines || '(패턴 없음)',
    '',
    '분류할 경보(JSON):',
    JSON.stringify(alert, null, 2),
    '',
    '위 경보를 block / alert / record 중 하나로 분류해 JSON 한 개만 출력하라.',
  ].join('\n');

  return { system, user };
}
