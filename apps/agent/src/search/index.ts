import { SearchTool } from '@product-scout/research';

import { MockSearchProvider } from './MockSearchProvider';

/** Development/test composition root for the C1 local search capability. */
export function createMockSearchTool(): SearchTool {
  return new SearchTool(new MockSearchProvider());
}

export { MockSearchProvider } from './MockSearchProvider';
