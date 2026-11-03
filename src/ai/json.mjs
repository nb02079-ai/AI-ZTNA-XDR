// 모델이 돌려준 글에서 첫 번째 JSON 객체를 안전하게 뽑아 파싱합니다.
// 코드펜스(```json ... ```)와 앞뒤 설명 문장이 섞여 있어도 균형 잡힌 중괄호를 찾아 잘라 냅니다.
import { AiError } from './errors.mjs';

/**
 * @param {string} text
 * @returns {any}
 */
export function extractJson(text) {
  if (typeof text !== 'string') {
    throw new AiError('모델 응답이 문자열이 아닙니다', { kind: 'format' });
  }
  let s = text.trim();

  // 코드펜스 안에 있으면 그 안쪽만 먼저 본다.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1].includes('{')) s = fence[1].trim();

  const start = s.indexOf('{');
  if (start === -1) {
    throw new AiError('응답에서 JSON 객체를 찾지 못했습니다', { kind: 'format' });
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const slice = s.slice(start, i + 1);
        try {
          return JSON.parse(slice);
        } catch (error) {
          throw new AiError('JSON 파싱에 실패했습니다', { kind: 'format', cause: error });
        }
      }
    }
  }
  throw new AiError('JSON 객체가 닫히지 않았습니다', { kind: 'format' });
}
