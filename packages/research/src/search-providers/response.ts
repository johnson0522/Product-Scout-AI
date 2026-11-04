import type { SearchResultItem } from '../search';
import { SearchProviderError } from './errors';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function invalidResponse(): SearchProviderError {
  return new SearchProviderError('invalid_response', 'Search provider returned an invalid response');
}

/** Explicit validation of untrusted JSON; returned text remains untrusted data. */
export function parseItems(value: unknown, snippetField: 'description' | 'content'): SearchResultItem[] {
  if (!Array.isArray(value)) throw invalidResponse();
  return value.map((item: unknown) => {
    if (!isRecord(item) || typeof item.title !== 'string' || !item.title.trim()
      || typeof item.url !== 'string' || typeof item[snippetField] !== 'string') {
      throw invalidResponse();
    }
    let url: URL;
    try {
      url = new URL(item.url);
    } catch {
      throw invalidResponse();
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalidResponse();
    const snippet = item[snippetField];
    if (typeof snippet !== 'string') throw invalidResponse();
    return { title: item.title, url: item.url, snippet };
  });
}
