import type { Source } from '@product-scout/domain';
import type { SearchExecutor } from './evidence-ingestion';
import type { SearchResult, SearchToolContext, SearchToolInput } from './search';
import type { WebFetcher } from './web-fetch';

export interface SourceStore {
  create(input: { readonly type: 'web'; readonly url: string; readonly title: string; readonly retrievedAt: Date }): Promise<Source>;
}

/** Fetches only capped search results. Failed pages retain the verbatim search
 * snippet; no synthesized content or source-success claim is substituted. */
export class SourceResearchSearch implements SearchExecutor {
  public constructor(
    private readonly search: SearchExecutor,
    private readonly web: WebFetcher,
    private readonly sources: SourceStore,
  ) {}

  public async execute(input: SearchToolInput, context: SearchToolContext): Promise<SearchResult> {
    const result = await this.search.execute(input, context);
    const items: SearchResult['items'][number][] = [];
    // The host-defined source budget is enforced even for a nonconforming provider.
    for (const [index, item] of result.items.slice(0, Math.min(input.limit ?? 10, 25)).entries()) {
      if (context.isCancelled?.()) throw new Error('Source collection cancelled');
      const invocationId = `${context.toolInvocationId}:fetch:${index}`;
      const now = context.now ?? (() => new Date());
      await context.emit?.({ type: 'tool.started', eventId: `${invocationId}:started`, sessionId: context.sessionId, occurredAt: now(), toolInvocationId: invocationId, toolName: 'web_fetch' });
      let snippet = item.snippet;
      let retrievedAt = now();
      let fetched = false;
      try {
        const page = await this.web.fetch({ url: item.url });
        snippet = page.text; retrievedAt = page.retrievedAt; fetched = true;
      } catch { /* A sanitized failed tool event makes excerpt fallback explicit. */ }
      if (context.isCancelled?.()) throw new Error('Source collection cancelled');
      await context.emit?.({ type: 'tool.completed', eventId: `${invocationId}:completed`, sessionId: context.sessionId, occurredAt: now(), toolInvocationId: invocationId, toolName: 'web_fetch', success: fetched, ...(fetched ? {} : { errorMessage: 'Page unavailable; retaining search excerpt' }) });
      const source = await this.sources.create({ type: 'web', url: item.url, title: item.title, retrievedAt });
      items.push({ ...item, snippet, sourceId: source.id });
    }
    return { query: result.query, items };
  }
}
