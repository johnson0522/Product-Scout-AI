import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpSearchConfig } from '@product-scout/config/search';
import type { SearchProvider, SearchQuery, SearchResult } from '@product-scout/research/search';
import { SearchToolInputError } from '@product-scout/research/search';
import { SearchProviderError } from '@product-scout/research/search-providers/errors';
import { invalidResponse, isRecord, parseItems } from '@product-scout/research/search-providers/response';

interface McpSearchProviderOptions extends McpSearchConfig {
  readonly createTransport?: () => Transport;
}

/** One bounded MCP session per search. Only the fixed web_search capability is called. */
export class McpSearchProvider implements SearchProvider {
  public constructor(private readonly options: McpSearchProviderOptions) {
    if (!options.command.trim() || /[\r\n\0]/.test(options.command)
      || !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 2_147_483_647
      || !Number.isSafeInteger(options.maxResponseBytes) || options.maxResponseBytes < 1) {
      throw new Error('Invalid MCP search executable, timeout, or response size');
    }
  }

  public async search(input: SearchQuery): Promise<SearchResult> {
    if (typeof input.query !== 'string' || !input.query.trim() || input.query.trim().length > 4000
      || (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100))) {
      throw new SearchToolInputError('MCP search requires a query of 1–4000 characters and a limit between 1 and 100');
    }
    const query = input.query.trim();
    const limit = Math.min(input.limit ?? 10, 20);
    const client = new Client({ name: 'product-scout-search', version: '0.1.0' });
    const transport = this.options.createTransport?.() ?? new StdioClientTransport({
      command: this.options.command,
      args: [],
      // The SDK inherits only basic OS environment variables. Do not forward app secrets.
      env: {
        AGENT_WEB_SEARCH_PROVIDERS: 'ddgs,exa,parallel',
        // DDGS may try several backends; keep each upstream attempt short enough to finish the fan-out.
        AGENT_WEB_SEARCH_TIMEOUT: String(Math.max(1, Math.min(5, Math.floor(this.options.timeoutMs / 3000)))),
        PYTHONIOENCODING: 'utf-8',
      },
      stderr: 'ignore',
    });
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new SearchProviderError('timeout', 'MCP search request timed out'));
        controller.abort();
      }, this.options.timeoutMs);
    });
    try {
      return await Promise.race([this.request(client, transport, query, limit, controller.signal), timeout]);
    } catch (error: unknown) {
      if (error instanceof SearchProviderError) throw error;
      // Do not leak process errors, provider diagnostics, paths, or MCP response bodies.
      throw new SearchProviderError('network', 'MCP search failed; check server installation and network connectivity');
    } finally {
      clearTimeout(timer);
      controller.abort();
      await client.close().catch(() => undefined);
    }
  }

  private async request(client: Client, transport: Transport, query: string, limit: number, signal: AbortSignal): Promise<SearchResult> {
    await client.connect(transport, { signal, timeout: this.options.timeoutMs });
    if (signal.aborted) throw new SearchProviderError('timeout', 'MCP search request timed out');
    const result = await client.callTool({
      name: 'web_search',
      arguments: { query, max_results: limit, providers: ['ddgs', 'exa', 'parallel'] },
    }, undefined, { signal, timeout: this.options.timeoutMs });
    // Check the complete decoded MCP result, including text and optional structured content.
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > this.options.maxResponseBytes) {
      throw new SearchProviderError('response_too_large', 'MCP search response exceeded the size limit');
    }
    if (result.isError) throw new SearchProviderError('upstream', 'MCP search providers failed');
    let payload: unknown = result.structuredContent;
    if (payload === undefined) {
      const content = result.content;
      if (!Array.isArray(content) || content.length !== 1) throw invalidResponse();
      const block: unknown = content[0];
      if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string') throw invalidResponse();
      try { payload = JSON.parse(block.text); } catch { throw invalidResponse(); }
    }
    if (!isRecord(payload) || !isRecord(payload.providers) || Object.keys(payload.providers).length === 0) throw invalidResponse();
    // Preserve source descriptions verbatim. Synthesized provider answers are not evidence.
    const items = Object.values(payload.providers).flatMap((provider: unknown) => {
      if (!isRecord(provider)) throw invalidResponse();
      return parseItems(provider.results, 'description');
    });
    const seen = new Set<string>();
    return { query, items: items.filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    }).slice(0, limit) };
  }
}
