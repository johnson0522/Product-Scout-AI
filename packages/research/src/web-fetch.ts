import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';

export interface WebFetchInput { readonly url: string }
export interface WebFetchResult {
  readonly url: string;
  readonly text: string;
  readonly retrievedAt: Date;
}
export interface WebFetcher { fetch(input: WebFetchInput): Promise<WebFetchResult> }
export interface WebFetchOptions {
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly maxTextCharacters?: number;
  readonly resolveAddresses?: (hostname: string) => Promise<readonly string[]>;
  readonly transport?: (url: URL, address: string, maxBytes: number, signal: AbortSignal) => Promise<{ readonly body: string; readonly contentType: string }>;
  readonly now?: () => Date;
}
export class WebFetchError extends Error {
  public constructor(message: string) { super(message); this.name = 'WebFetchError'; }
}

/** Conservative public IPv4 policy. No credentials, proxies, cookies, redirects,
 * alternative ports, IPv6, or private/reserved networks. DNS is pinned to TLS. */
export class HttpsWebFetcher implements WebFetcher {
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxTextCharacters: number;
  public constructor(private readonly options: WebFetchOptions = {}) {
    this.timeoutMs = limit(options.timeoutMs, 10_000, 60_000);
    this.maxBytes = limit(options.maxBytes, 1_048_576, 4_194_304);
    this.maxTextCharacters = limit(options.maxTextCharacters, 8000, 32_000);
  }

  public async fetch(input: WebFetchInput): Promise<WebFetchResult> {
    const url = validatedFetchUrl(input.url);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new WebFetchError('Web fetch timed out')); }, this.timeoutMs);
    });
    try {
      const operation = async (): Promise<WebFetchResult> => {
        const addresses = isIP(url.hostname) ? [url.hostname] : await (this.options.resolveAddresses
          ?? (async (hostname) => (await lookup(hostname, { family: 4, all: true })).map((item) => item.address)))(url.hostname);
        if (controller.signal.aborted) throw new WebFetchError('Web fetch timed out');
        if (addresses.length === 0 || addresses.some((address) => !isPublicIpv4(address))) {
          throw new WebFetchError('Web fetch requires a public IPv4 destination');
        }
        const response = await (this.options.transport ?? fetchPinned)(url, addresses[0]!, this.maxBytes, controller.signal);
        if (Buffer.byteLength(response.body, 'utf8') > this.maxBytes) throw new WebFetchError('Web response exceeds size limit');
        const contentType = response.contentType.split(';')[0]?.trim().toLowerCase();
        if (contentType !== 'text/html' && contentType !== 'text/plain') throw new WebFetchError('Unsupported web content type');
        const content = contentType === 'text/html' ? htmlToText(response.body) : response.body;
        const text = content.replace(/\s+/g, ' ').trim().slice(0, this.maxTextCharacters);
        if (!text) throw new WebFetchError('Web page has no usable text');
        return { url: url.href, text, retrievedAt: this.options.now?.() ?? new Date() };
      };
      return await Promise.race([operation(), deadline]);
    } catch (error: unknown) {
      if (error instanceof WebFetchError) throw error;
      throw new WebFetchError('Web fetch request failed');
    } finally { if (timer !== undefined) clearTimeout(timer); controller.abort(); }
  }
}

export function validatedFetchUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new WebFetchError('Invalid web URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || url.hostname === 'localhost' || url.hostname.endsWith('.localhost')
    || url.hostname.endsWith('.local') || url.hostname.endsWith('.internal')) {
    throw new WebFetchError('Web fetch requires public HTTPS without credentials or a custom port');
  }
  url.hash = '';
  return url;
}

export function isPublicIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  if (a === undefined || b === undefined || c === undefined) return false;
  return a !== 0 && a !== 10 && a !== 127 && a < 224
    && !(a === 100 && b >= 64 && b <= 127)
    && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31)
    && !(a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
    && !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    && !(a === 203 && b === 0 && c === 113);
}

function fetchPinned(url: URL, address: string, maxBytes: number, signal: AbortSignal): Promise<{ body: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const req = request({
      protocol: 'https:', hostname: address, port: 443, servername: url.hostname,
      path: url.pathname + url.search, method: 'GET', signal, agent: false,
      headers: { Host: url.host, Accept: 'text/html, text/plain', 'Accept-Encoding': 'identity', 'User-Agent': 'ProductScout/0.1 (research)' },
    }, (response) => {
      if (response.statusCode !== 200 || response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
        response.destroy(); reject(new WebFetchError('Web fetch rejected HTTP status, redirect, or encoding')); return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) { response.destroy(); reject(new WebFetchError('Web response exceeds size limit')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8'), contentType: response.headers['content-type'] ?? '' }));
    });
    req.on('error', reject);
    req.end();
  });
}

function htmlToText(html: string): string {
  const stripped = html.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  return stripped.replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_match, entity: string) =>
    ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[entity] ?? ' ');
}
function limit(value: number | undefined, fallback: number, maximum: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0 || result > maximum) throw new WebFetchError('Invalid web fetch limit');
  return result;
}
