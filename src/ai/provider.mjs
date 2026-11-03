// 제공자 공장: 설정의 provider 값에 따라 알맞은 제공자를 만들어 줍니다.
// 모든 제공자는 같은 모양의 generate(req) -> { text, provider, model, usage } 를 제공합니다.
import { loadConfig } from './config.mjs';
import { createClaudeProvider } from './providers/claude.mjs';
import { createLocalProvider } from './providers/local.mjs';
import { createMockProvider } from './providers/mock.mjs';
import { AiError } from './errors.mjs';

export function createProvider(config = loadConfig()) {
  switch (config.provider) {
    case 'claude':
      return createClaudeProvider(config);
    case 'local':
      return createLocalProvider(config);
    case 'mock':
      return createMockProvider(config);
    default:
      throw new AiError(`알 수 없는 제공자: ${config.provider}`, { kind: 'config' });
  }
}

export { loadConfig } from './config.mjs';
export { extractJson } from './json.mjs';
export { AiError } from './errors.mjs';
