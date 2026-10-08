import type {
  SearchProvider,
  SearchQuery,
  SearchResult,
  SearchResultItem,
} from '@product-scout/research';

const HVAC_FIXTURE: readonly SearchResultItem[] = [
  {
    title: 'HVAC Business Management Software',
    url: 'https://example.test/hvac-business-management',
    snippet: 'Scheduling, dispatch, estimates, and invoicing for HVAC service businesses.',
  },
  {
    title: 'HVAC Contractor Software',
    url: 'https://example.test/hvac-contractor-software',
    snippet: 'Field service workflows for HVAC contractors and their technicians.',
  },
  {
    title: 'HVAC Service Operations Platform',
    url: 'https://example.test/hvac-service-operations',
    snippet: 'A unified view of jobs, customers, maintenance plans, and team capacity.',
  },
];

const FIXTURES: Readonly<Record<string, readonly SearchResultItem[]>> = {
  'hvac software': HVAC_FIXTURE,
};

/** Deterministic local fixtures for tests and development without network access. */
export class MockSearchProvider implements SearchProvider {
  public async search(query: SearchQuery): Promise<SearchResult> {
    const normalized = normalizeQuery(query.query);
    const items = FIXTURES[normalized] ?? [];
    const limit = query.limit ?? items.length;
    return {
      query: query.query,
      items: items.slice(0, limit),
    };
  }
}

function normalizeQuery(query: string): string {
  return query.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}
