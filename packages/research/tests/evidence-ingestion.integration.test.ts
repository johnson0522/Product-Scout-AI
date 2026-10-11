import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, DrizzleEvidenceStoreRepository } from '@product-scout/db';

import {
  SearchResultEvidenceIngestion,
  SearchTool,
  SearchToolExecutionError,
  type EvidenceIdGenerator,
} from '../src';
import type { EvidenceId } from '@product-scout/evidence';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseAuthorized = process.env.PRODUCT_SCOUT_TEST_DATABASE === '1'
  && isDedicatedTestUrl(testDatabaseUrl);

if (!testDatabaseAuthorized) {
  console.warn('BLOCKED: PostgreSQL ingestion integration tests require PRODUCT_SCOUT_TEST_DATABASE=1 and a dedicated TEST_DATABASE_URL');
}

const describeIntegration = testDatabaseAuthorized ? describe : describe.skip;
const evidencePrefix = `ingestion-integration-${Date.now()}-`;
let nextEvidenceNumber = 1;

function isDedicatedTestUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'postgresql:'
      && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
      && parsed.port === '55432'
      && parsed.pathname === '/product_scout_test';
  } catch {
    return false;
  }
}

class SequenceIds implements EvidenceIdGenerator {
  public generate(): EvidenceId {
    return `${evidencePrefix}${nextEvidenceNumber++}`;
  }
}

function createSearchTool(items: readonly { title: string; url: string; snippet: string }[]) {
  return new SearchTool({
    search: async (query) => ({ query: query.query, items }),
  });
}

const context = {
  sessionId: 'postgres-integration-session',
  researchRunId: 'postgres-integration-run',
  toolInvocationId: 'postgres-integration-tool',
  now: () => new Date('2026-06-01T12:00:00.000Z'),
};

describeIntegration('SearchTool to PostgreSQL Evidence ingestion integration', () => {
  let database: ReturnType<typeof createDb>;
  let repository: DrizzleEvidenceStoreRepository;

  beforeAll(() => {
    database = createDb(testDatabaseUrl);
    repository = new DrizzleEvidenceStoreRepository(database.db);
  });

  afterAll(async () => {
    await database.client.unsafe('delete from evidence_store where id like $1', [`${evidencePrefix}%`]);
    await database.client.end({ timeout: 5 });
  });

  it('persists two SearchTool results and verifies them by reading PostgreSQL', async () => {
    const items = [
      { title: 'First result', url: 'https://example.test/first', snippet: 'First excerpt' },
      { title: 'Second result', url: 'https://example.test/second', snippet: 'Second excerpt' },
    ];
    const result = await new SearchResultEvidenceIngestion(repository, {
      idGenerator: new SequenceIds(),
      now: () => new Date('2026-06-01T12:00:00.000Z'),
    }).execute({
      search: createSearchTool(items),
      searchInput: { query: 'integration' },
      searchContext: context,
    });

    expect(result).toMatchObject({ total: 2, mapped: 2, persisted: 2 });
    for (const item of result.items) {
      if (item.status !== 'persisted') throw new Error('Expected persisted item');
      await expect(repository.getById(item.evidence.id)).resolves.toEqual(item.evidence);
    }
  });

  it('persists valid items while excluding an invalid mapped item', async () => {
    const result = await new SearchResultEvidenceIngestion(repository, {
      idGenerator: new SequenceIds(),
      now: () => new Date('2026-06-01T12:00:00.000Z'),
    }).execute({
      search: createSearchTool([
        { title: 'Valid', url: 'https://example.test/valid', snippet: 'Valid excerpt' },
        { title: '', url: 'https://example.test/invalid', snippet: 'Invalid title' },
      ]),
      searchInput: { query: 'partial mapping' },
      searchContext: context,
    });

    expect(result).toMatchObject({ total: 2, mapped: 1, persisted: 1 });
    expect(result.items.map((item) => item.status)).toEqual(['persisted', 'mapping_failed']);
  });

  it('continues after a real duplicate-ID persistence failure', async () => {
    const ids: EvidenceId[] = [`${evidencePrefix}duplicate`, `${evidencePrefix}duplicate`, `${evidencePrefix}after`];
    const idGenerator: EvidenceIdGenerator = { generate: () => ids.shift() ?? `${evidencePrefix}unexpected` };
    const result = await new SearchResultEvidenceIngestion(repository, {
      idGenerator,
      now: () => new Date('2026-06-01T12:00:00.000Z'),
    }).execute({
      search: createSearchTool([
        { title: 'First', url: 'https://example.test/duplicate-a', snippet: 'First' },
        { title: 'Duplicate', url: 'https://example.test/duplicate-b', snippet: 'Duplicate' },
        { title: 'After', url: 'https://example.test/after', snippet: 'After' },
      ]),
      searchInput: { query: 'partial persistence' },
      searchContext: context,
    });

    expect(result).toMatchObject({ total: 3, mapped: 3, persisted: 2 });
    expect(result.items.map((item) => item.status)).toEqual([
      'persisted',
      'persistence_failed',
      'persisted',
    ]);
    await expect(repository.getById(`${evidencePrefix}after`)).resolves.toBeDefined();
  });

  it('persists duplicate URLs as separate Evidence records', async () => {
    const result = await new SearchResultEvidenceIngestion(repository, {
      idGenerator: new SequenceIds(),
      now: () => new Date('2026-06-01T12:00:00.000Z'),
    }).execute({
      search: createSearchTool([
        { title: 'Same URL one', url: 'https://example.test/same', snippet: 'One' },
        { title: 'Same URL two', url: 'https://example.test/same', snippet: 'Two' },
      ]),
      searchInput: { query: 'duplicate URL' },
      searchContext: context,
    });

    expect(result.persisted).toBe(2);
    const persisted = result.items.filter((item) => item.status === 'persisted');
    expect(persisted).toHaveLength(2);
    expect(persisted[0]?.evidence.id).not.toBe(persisted[1]?.evidence.id);
  });

  it('does not write an empty SearchResult', async () => {
    const result = await new SearchResultEvidenceIngestion(repository, {
      idGenerator: new SequenceIds(),
      now: () => new Date('2026-06-01T12:00:00.000Z'),
    }).execute({
      search: createSearchTool([]),
      searchInput: { query: 'empty' },
      searchContext: context,
    });

    expect(result).toEqual({ query: 'empty', total: 0, mapped: 0, persisted: 0, items: [] });
  });

  it('preserves SearchToolExecutionError and writes nothing on search failure', async () => {
    const search = new SearchTool({
      search: async () => {
        throw new Error('provider unavailable');
      },
    });

    await expect(new SearchResultEvidenceIngestion(repository).execute({
      search,
      searchInput: { query: 'failure' },
      searchContext: context,
    })).rejects.toBeInstanceOf(SearchToolExecutionError);
  });
});
