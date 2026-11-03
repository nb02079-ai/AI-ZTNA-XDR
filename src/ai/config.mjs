// 환경변수에서 AI 설정을 읽어 제공자별 구성으로 정리합니다.
import { AiError } from './errors.mjs';

function numberOr(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function intOr(value, fallback) {
  return Math.trunc(numberOr(value, fallback));
}

/**
 * @param {Record<string,string|undefined>} [env]
 */
export function loadConfig(env = process.env) {
  const provider = (env.AI_PROVIDER || 'claude').trim().toLowerCase();
  const common = {
    provider,
    temperature: numberOr(env.AI_TEMPERATURE, 0),
    maxTokens: intOr(env.AI_MAX_TOKENS, 1024),
    timeoutMs: intOr(env.AI_TIMEOUT_MS, 30000),
  };

  if (provider === 'claude') {
    return {
      ...common,
      model: (env.AI_MODEL || env.CLAUDE_MODEL || 'claude-sonnet-5-5').trim(),
      apiKey: (env.ANTHROPIC_API_KEY || '').trim(),
      apiUrl: (env.CLAUDE_API_URL || 'https://api.anthropic.com/v1/messages').trim(),
      anthropicVersion: (env.ANTHROPIC_VERSION || '2023-06-01').trim(),
    };
  }
  if (provider === 'local') {
    return {
      ...common,
      model: (env.AI_MODEL || env.LOCAL_AI_MODEL || 'qwen2.5:7b').trim(),
      baseUrl: (env.LOCAL_AI_URL || 'http://127.0.0.1:11434').trim(),
    };
  }
  if (provider === 'mock') {
    return { ...common, model: (env.AI_MODEL || 'mock').trim() };
  }
  throw new AiError(`알 수 없는 AI_PROVIDER: ${provider} (claude | local | mock 중 하나여야 합니다)`, { kind: 'config' });
}
