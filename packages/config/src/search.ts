export interface SearchConfig {
  readonly provider: 'brave' | 'tavily';
  readonly apiKey: string;
  /** Complete search endpoint, not an origin or API prefix. */
  readonly baseUrl?: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
}

export class SearchConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SearchConfigError';
  }
}

/** Read lazily at the search composition boundary; never fall back to fixtures. */
export function readSearchConfig(env: NodeJS.ProcessEnv = process.env): SearchConfig {
  const provider = env.SEARCH_PROVIDER?.trim();
  if (provider !== 'brave' && provider !== 'tavily') {
    throw new SearchConfigError('SEARCH_PROVIDER must be brave or tavily');
  }
  const apiKey = env.SEARCH_API_KEY?.trim();
  if (!apiKey || /[\r\n]/.test(apiKey)) {
    throw new SearchConfigError('SEARCH_API_KEY must be a non-empty, single-line secret');
  }
  const baseUrl = env.SEARCH_BASE_URL?.trim();
  if (baseUrl) {
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new SearchConfigError('SEARCH_BASE_URL must be an absolute HTTPS search endpoint');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new SearchConfigError('SEARCH_BASE_URL must use HTTPS without credentials, query, or fragment');
    }
  }
  return {
    provider,
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    timeoutMs: positiveInteger(env.SEARCH_TIMEOUT_MS, 10_000, 'SEARCH_TIMEOUT_MS', 2_147_483_647),
    maxResponseBytes: positiveInteger(env.SEARCH_MAX_RESPONSE_BYTES, 1_048_576, 'SEARCH_MAX_RESPONSE_BYTES'),
  };
}

function positiveInteger(value: string | undefined, fallback: number, name: string, max = Number.MAX_SAFE_INTEGER): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value.trim())) {
    throw new SearchConfigError(`${name} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new SearchConfigError(`${name} must be a positive integer no greater than ${max}`);
  }
  return parsed;
}
