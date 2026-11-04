import type { SearchResultItem } from '../search';
import { invalidResponse, isRecord, parseItems } from './response';

export const TAVILY_SEARCH_ENDPOINT = 'https://api.tavily.com/search';

export function tavilyRequest(endpoint: string, apiKey: string, query: string, limit: number): [URL, RequestInit] {
  return [new URL(endpoint), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      query,
      max_results: limit,
      search_depth: 'basic',
      include_answer: false,
      include_raw_content: false,
    }),
  }];
}

export function parseTavilyResponse(body: unknown): SearchResultItem[] {
  if (!isRecord(body)) throw invalidResponse();
  return parseItems(body.results, 'content');
}
