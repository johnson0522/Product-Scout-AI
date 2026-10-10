import { describe, expect, it, vi } from 'vitest';
import type { Evidence, EvidenceRepository } from '@product-scout/evidence';

import {
  SearchResultEvidenceIngestion,
  SearchResultEvidenceMapper,
  SearchTool,
  SearchToolExecutionError,
  type EvidenceIdGenerator,
  type SearchExecutor,
  type SearchResultItem,
  type SearchToolContext,
  type SearchToolInput,
} from '../src';

const context: SearchToolContext = {
  sessionId: 'session-1',
  researchRunId: 'run-1',
  toolInvocationId: 'tool-1',
};

const item: SearchResultItem = {
  title: 'Workflow research',
  url: 'https://example.test/research/workflow',
  snippet: 'Teams report repeated manual work.',
};

class SequenceIds implements EvidenceIdGenerator {
  private nextId = 1;

  public generate(): string {
    return `evidence-${this.nextId++}`;
  }
}

class MemoryEvidenceRepository implements EvidenceRepository {
  public readonly values: Evidence[] = [];
  public failForUrl: string | undefined;

  public async create(evidence: Evidence): Promise<void> {
    if (evidence.source.url === this.failForUrl) {
      throw new Error('database unavailable');
    }
    this.values.push(evidence);
  }

  public async getById(id: string): Promise<Evidence | null> {
    return this.values.find((evidence) => evidence.id === id) ?? null;
  }
}

function fakeSearch(items: readonly SearchResultItem[]): SearchExecutor {
  return {
    execute: vi.fn(async (_input: SearchToolInput, _context: SearchToolContext) => ({
      query: 'workflow research',
      items,
    })),
  };
}

describe('SearchResultEvidenceMapper', () => {
  it('maps real SearchResultItem fields through createEvidence', () => {
    const mapper = new SearchResultEvidenceMapper({
      idGenerator: new SequenceIds(),
      now: () => new Date('2026-05-01T00:00:00.000Z'),
    });

    expect(mapper.map(item)).toEqual({
      id: 'evidence-1',
      source: {
        url: item.url,
        title: item.title,
      },
      title: item.title,
      excerpt: item.snippet,
      retrievedAt: new Date('2026-05-01T00:00:00.000Z'),
    });
  });

  it('rejects invalid URLs and missing required fields through domain validation', () => {
    const mapper = new SearchResultEvidenceMapper({
      idGenerator: new SequenceIds(),
      now: () => new Date('2026-05-01T00:00:00.000Z'),
    });

    expect(() => mapper.map({ ...item, url: 'not-a-url' })).toThrow(
      'source.url must be an http(s) URL',
    );
    expect(() => mapper.map({ ...item, title: '' })).toThrow(
      'source.title must be a non-empty string',
    );
    expect(() => mapper.map({ ...item, snippet: '' })).toThrow(
      'excerpt must be a non-empty string',
    );
  });
});

describe('SearchResultEvidenceIngestion', () => {
  it('persists every valid item and reports deterministic counts', async () => {
    const repository = new MemoryEvidenceRepository();
    const search = fakeSearch([item, item]);
    const ingestion = new SearchResultEvidenceIngestion(repository, {
      idGenerator: new SequenceIds(),
      now: () => new Date('2026-05-01T00:00:00.000Z'),
    });

    const result = await ingestion.execute({
      search,
      searchInput: { query: 'workflow research' },
      searchContext: context,
    });

    expect(result).toMatchObject({
      total: 2,
      mapped: 2,
      persisted: 2,
      query: 'workflow research',
    });
    expect(result.items.map((entry) => entry.status)).toEqual(['persisted', 'persisted']);
    expect(repository.values.map((entry) => entry.id)).toEqual(['evidence-1', 'evidence-2']);
    expect(repository.values.map((entry) => entry.source.url)).toEqual([item.url, item.url]);
  });

  it('returns an empty result without repository writes', async () => {
    const repository = new MemoryEvidenceRepository();
    const search = fakeSearch([]);
    const result = await new SearchResultEvidenceIngestion(repository, {
      idGenerator: new SequenceIds(),
      now: () => new Date('2026-05-01T00:00:00.000Z'),
    }).execute({ search, searchInput: { query: 'empty' }, searchContext: context });

    expect(result).toEqual({
      query: 'workflow research',
      total: 0,
      mapped: 0,
      persisted: 0,
      items: [],
    });
    expect(repository.values).toHaveLength(0);
  });

  it('continues after a mapping failure and does not persist that item', async () => {
    const repository = new MemoryEvidenceRepository();
    const search = fakeSearch([
      item,
      { ...item, title: '', url: 'https://example.test/invalid' },
    ]);
    const result = await new SearchResultEvidenceIngestion(repository, {
      idGenerator: new SequenceIds(),
      now: () => new Date('2026-05-01T00:00:00.000Z'),
    }).execute({ search, searchInput: { query: 'mixed' }, searchContext: context });

    expect(result).toMatchObject({ total: 2, mapped: 1, persisted: 1 });
    expect(result.items.map((entry) => entry.status)).toEqual(['persisted', 'mapping_failed']);
    expect(repository.values).toHaveLength(1);
  });

  it('distinguishes persistence failure without counting it as persisted', async () => {
    const repository = new MemoryEvidenceRepository();
    repository.failForUrl = item.url;
    const search = fakeSearch([item, { ...item, url: 'https://example.test/saved' }]);
    const result = await new SearchResultEvidenceIngestion(repository, {
      idGenerator: new SequenceIds(),
      now: () => new Date('2026-05-01T00:00:00.000Z'),
    }).execute({ search, searchInput: { query: 'mixed' }, searchContext: context });

    expect(result).toMatchObject({ total: 2, mapped: 2, persisted: 1 });
    expect(result.items.map((entry) => entry.status)).toEqual([
      'persistence_failed',
      'persisted',
    ]);
    expect(repository.values).toHaveLength(1);
  });

  it('preserves SearchTool failure semantics instead of returning an empty result', async () => {
    const repository = new MemoryEvidenceRepository();
    const search = new SearchTool({
      search: async () => {
        throw new Error('search unavailable');
      },
    });

    await expect(new SearchResultEvidenceIngestion(repository).execute({
      search,
      searchInput: { query: 'failure' },
      searchContext: context,
    })).rejects.toBeInstanceOf(SearchToolExecutionError);
    expect(repository.values).toHaveLength(0);
  });
});