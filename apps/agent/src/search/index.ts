import { readSearchConfig, type SearchConfig } from '@product-scout/config/search';
import { SearchTool } from '@product-scout/research/search';
import { HttpSearchProvider } from '@product-scout/research/search-providers/http-search-provider';

import { MockSearchProvider } from './MockSearchProvider';
import { McpSearchProvider } from './McpSearchProvider';

/** Server-side production composition; invalid or missing configuration fails explicitly. */
export function createSearchTool(config: SearchConfig = readSearchConfig()): SearchTool {
  return new SearchTool(config.provider === 'agent-web-search-mcp'
    ? new McpSearchProvider(config)
    : new HttpSearchProvider(config));
}

/** Development/test composition root for the C1 local search capability. */
export function createMockSearchTool(): SearchTool {
  return new SearchTool(new MockSearchProvider());
}

export { MockSearchProvider } from './MockSearchProvider';
