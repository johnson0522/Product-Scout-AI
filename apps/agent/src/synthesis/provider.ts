import { resolve } from 'node:path';

export const YUNQIAO_PROVIDER = 'yunqiao';
export const YUNQIAO_MODEL = 'gpt-6.1-sol';

export interface DshProviderSelection {
  readonly patches: readonly string[];
  readonly provider?: string;
  readonly model?: string;
}

/** Provider details stay inside the Runtime; no credentials enter Cordis YAML. */
export function selectDshProvider(
  processCwd: string,
  env: Readonly<Record<string, string | undefined>>,
  provider?: string,
  model?: string,
): DshProviderSelection {
  if (provider !== YUNQIAO_PROVIDER) {
    return {
      patches: [],
      ...(provider === undefined ? {} : { provider }),
      ...(model === undefined ? {} : { model }),
    };
  }
  if (!env.LLM_API_KEY?.trim()) throw new Error('LLM_API_KEY is required for DSH_PROVIDER=yunqiao');
  let endpoint: URL;
  try {
    endpoint = new URL(env.LLM_BASE_URL?.trim() || 'https://api.yunqiao.me/v1');
  } catch {
    throw new Error('Invalid Yunqiao LLM_BASE_URL');
  }
  if (endpoint.origin !== 'https://api.yunqiao.me' || endpoint.username || endpoint.password
    || endpoint.search || endpoint.hash || !['/', '/v1', '/v1/'].includes(endpoint.pathname)) {
    throw new Error('Yunqiao only supports LLM_BASE_URL=https://api.yunqiao.me[/v1]');
  }
  if (model !== undefined && model !== YUNQIAO_MODEL) {
    throw new Error(`The Yunqiao Runtime currently supports only ${YUNQIAO_MODEL}`);
  }
  return {
    patches: [resolve(processCwd, 'apps/agent/src/dsh/yunqiao-responses.patch.yml')],
    provider: YUNQIAO_PROVIDER,
    model: YUNQIAO_MODEL,
  };
}
