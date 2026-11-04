import type { SearchResultItem } from '../search';
import { invalidResponse, isRecord, parseItems } from './response';

export const BRAVE_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

export function braveRequest(endpoint: string, apiKey: string, query: string, limit: number): [URL, RequestInit] {
  const url = new URL(endpoint);
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(limit));
  return [url, { method: 'GET', headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey } }];
}

export function parseBraveResponse(body: unknown): SearchResultItem[] {
  if (!isRecord(body)) throw invalidResponse();
  // Brave may omit the web section when there are no web results.
  if (body.web === undefined && body.type === 'search') return [];
  if (!isRecord(body.web)) throw invalidResponse();
  return parseItems(body.web.results, 'description');
}
