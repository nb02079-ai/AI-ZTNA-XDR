// 모듈별 patterns.json을 읽어, AI 판정에 넣을 근거 묶음으로 정리합니다.
// patterns.json은 vault에서 복사한 읽기 자산입니다(출처: SOURCE.md). 내용은 고치지 않습니다.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODULE_KEYS } from './rule-fallback.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const cache = new Map();

/**
 * @param {string} moduleKey
 * @param {string} [root]
 * @returns {Promise<any>}
 */
export async function loadPatterns(moduleKey, root = ROOT) {
  if (!MODULE_KEYS.includes(moduleKey)) {
    throw new Error(`알 수 없는 모듈: ${moduleKey}`);
  }
  const key = `${root}::${moduleKey}`;
  if (cache.has(key)) return cache.get(key);
  const file = join(root, 'aleph-source', 'xdr', moduleKey, 'patterns.json');
  const parsed = JSON.parse(await readFile(file, 'utf8'));
  cache.set(key, parsed);
  return parsed;
}

/**
 * AI 프롬프트에 넣기 좋은 짧은 근거 요약을 만듭니다.
 * 패턴마다 이름·조건·근거(한 줄)·기법을 추려, 토큰을 아끼면서 판단 근거를 전달합니다.
 * @param {any} patterns loadPatterns의 반환
 * @returns {{basis:object, items:Array<{name:string,technique?:string,condition:string,evidence:string,alertOnly:boolean}>}}
 */
export function summarizePatterns(patterns) {
  const list = Array.isArray(patterns?.patterns) ? patterns.patterns : [];
  const items = list.map((p) => ({
    name: String(p?.name ?? ''),
    technique: p?.technique ? String(p.technique) : undefined,
    condition: String(p?.condition ?? ''),
    evidence: String(p?.evidence ?? ''),
    alertOnly: Boolean(p?.alertOnly),
  }));
  const basis = patterns?.basis && typeof patterns.basis === 'object'
    ? {
        technique: patterns.basis.technique,
        name: patterns.basis.name,
        url: patterns.basis.url,
        note: patterns.basis.note,
      }
    : {};
  return { basis, items };
}
