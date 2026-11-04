import { readSearchConfig, type SearchConfig } from '@product-scout/config/search';
import { SearchTool } from '@product-scout/research/search';
import { HttpSearchProvider } from '@product-scout/research/search-providers/http-search-provider';

import { MockSearchProvider } from './MockSearchProvider';

/** Server-side production composition; invalid or missing configuration fails explicitly. */
export function createSearchTool(config: SearchConfig = readSearchConfig()): SearchTool {
  return new SearchTool(new HttpSearchProvider(config));
}

/** Development/test composition root for the C1 local search capability. */
export function createMockSearchTool(): SearchTool {
  return new SearchTool(new MockSearchProvider());
}

export { MockSearchProvider } from './MockSearchProvider';
