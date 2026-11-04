import type { SearchProvider, SearchQuery, SearchResult } from '../search';
import { SearchToolInputError } from '../search';
import { braveRequest, BRAVE_SEARCH_ENDPOINT, parseBraveResponse } from './brave';
import { SearchProviderError } from './errors';
import { invalidResponse } from './response';
import { tavilyRequest, TAVILY_SEARCH_ENDPOINT, parseTavilyResponse } from './tavily';

export interface HttpSearchProviderOptions {
  readonly provider: 'brave' | 'tavily';
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly fetch?: typeof globalThis.fetch;
}

/** Transport adapter only: no persistence, prompting, automatic retries, or result URL fetching. */
export class HttpSearchProvider implements SearchProvider {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  public constructor(private readonly options: HttpSearchProviderOptions) {
    if (options.provider !== 'brave' && options.provider !== 'tavily') {
      throw new Error('Search provider must be brave or tavily');
    }
    if (!options.apiKey.trim() || /[\r\n]/.test(options.apiKey)) {
      throw new Error('Search API key must be a non-empty, single-line secret');
    }
    this.endpoint = options.baseUrl ?? (options.provider === 'brave' ? BRAVE_SEARCH_ENDPOINT : TAVILY_SEARCH_ENDPOINT);
    let url: URL;
    try {
      url = new URL(this.endpoint);
    } catch {
      throw new Error('Search endpoint must be an absolute HTTPS URL');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('Search endpoint must use HTTPS without credentials, query, or fragment');
    }
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxResponseBytes = options.maxResponseBytes ?? 1_048_576;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 2_147_483_647
      || !Number.isSafeInteger(this.maxResponseBytes) || this.maxResponseBytes < 1) {
      throw new Error('Search timeout and response size must be positive integers within supported bounds');
    }
  }

  public async search(input: SearchQuery): Promise<SearchResult> {
    if (typeof input.query !== 'string' || !input.query.trim()
      || (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100))) {
      throw new SearchToolInputError('Search requires a non-empty query and a limit between 1 and 100');
    }
    const query = input.query.trim();
    // Both APIs return at most 20 results per request; E1 does not paginate.
    const limit = Math.min(input.limit ?? 10, 20);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new SearchProviderError('timeout', 'Search provider request timed out'));
        controller.abort();
      }, this.timeoutMs);
    });
    try {
      // Race the entire operation, including response reads, even if an injected fetch ignores abort.
      return await Promise.race([this.request(query, limit, controller.signal), timeout]);
    } catch (error: unknown) {
      if (error instanceof SearchProviderError) throw error;
      throw new SearchProviderError('network', 'Search provider network request failed');
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  private async request(query: string, limit: number, signal: AbortSignal): Promise<SearchResult> {
    const [url, init] = this.options.provider === 'brave'
      ? braveRequest(this.endpoint, this.options.apiKey, query, limit)
      : tavilyRequest(this.endpoint, this.options.apiKey, query, limit);
    const fetcher = this.options.fetch ?? globalThis.fetch;
    const response = await fetcher(url, { ...init, signal, redirect: 'error' });
    // A late response from an abort-ignoring transport must not be consumed.
    if (signal.aborted) {
      void response.body?.cancel().catch(() => undefined);
      throw new SearchProviderError('timeout', 'Search provider request timed out');
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      const kind = response.status === 401 || response.status === 403 ? 'unauthorized'
        : response.status === 429 ? 'rate_limited' : 'upstream';
      throw new SearchProviderError(kind, `Search provider returned HTTP ${response.status}`, response.status);
    }
    const body = await readJson(response, this.maxResponseBytes, signal);
    const items = this.options.provider === 'brave' ? parseBraveResponse(body) : parseTavilyResponse(body);
    return { query, items: items.slice(0, limit) };
  }
}

async function readJson(response: Response, maxBytes: number, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new SearchProviderError('response_too_large', 'Search provider response exceeded the size limit');
  }
  if (!response.body) throw invalidResponse();
  const reader = response.body.getReader();
  const cancel = (): void => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (!signal.aborted) {
      const chunk = await reader.read();
      if (signal.aborted) throw new SearchProviderError('timeout', 'Search provider request timed out');
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        cancel();
        throw new SearchProviderError('response_too_large', 'Search provider response exceeded the size limit');
      }
      chunks.push(chunk.value);
    }
    if (signal.aborted) throw new SearchProviderError('timeout', 'Search provider request timed out');
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return parsed;
  } catch {
    throw invalidResponse();
  }
}
