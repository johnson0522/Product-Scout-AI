import { describe, expect, it, vi } from 'vitest';
import { createEvidence } from '@product-scout/evidence';

import {
  DrizzleEvidenceStoreRepository,
  type Database,
  evidenceStore,
} from '../src';

type EvidenceStoreInsert = typeof evidenceStore.$inferInsert;
type EvidenceStoreRow = typeof evidenceStore.$inferSelect;

const storedAt = new Date('2026-04-05T06:07:08.123Z');

function validEvidence() {
  return createEvidence({
    id: 'evidence-c2-1',
    source: {
      url: 'https://example.test/research/1',
      title: 'Original source',
      domain: 'example.test',
    },
    title: 'Repeated workflow pain',
    excerpt: 'Teams spend several hours each week reconciling the same records.',
    retrievedAt: storedAt,
  });
}

function createDatabaseMock(rows: readonly EvidenceStoreRow[] = []) {
  const values = vi.fn<(value: EvidenceStoreInsert) => Promise<void>>();
  values.mockResolvedValue(undefined);

  const limit = vi.fn<(count: number) => Promise<readonly EvidenceStoreRow[]>>();
  limit.mockResolvedValue(rows);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const insert = vi.fn(() => ({ values }));

  return {
    db: { insert, select } as unknown as Database,
    insert,
    values,
    limit,
  };
}

describe('DrizzleEvidenceStoreRepository (mock-based)', () => {
  it('creates a C2 evidence record without generating or changing its fields', async () => {
    const database = createDatabaseMock();
    const repository = new DrizzleEvidenceStoreRepository(database.db);
    const evidence = validEvidence();

    await expect(repository.create(evidence)).resolves.toBeUndefined();

    expect(database.insert).toHaveBeenCalledWith(evidenceStore);
    expect(database.values).toHaveBeenCalledWith(expect.objectContaining({
      id: evidence.id,
      sourceUrl: evidence.source.url,
      sourceTitle: evidence.source.title,
      sourceDomain: evidence.source.domain,
      title: evidence.title,
      excerpt: evidence.excerpt,
    }));
    expect(database.values.mock.calls[0]?.[0].retrievedAt).toBeDefined();
  });

  it('rehydrates a valid domain object and preserves all source and evidence fields', async () => {
    const row: EvidenceStoreRow = {
      id: 'evidence-c2-1',
      sourceUrl: 'https://example.test/research/1',
      sourceTitle: 'Original source',
      sourceDomain: 'example.test',
      title: 'Repeated workflow pain',
      excerpt: 'Teams spend several hours each week reconciling the same records.',
      retrievedAt: storedAt,
    };
    const database = createDatabaseMock([row]);
    const repository = new DrizzleEvidenceStoreRepository(database.db);

    const result = await repository.getById('evidence-c2-1');

    expect(result).toEqual({
      id: row.id,
      source: {
        url: row.sourceUrl,
        title: row.sourceTitle,
        domain: row.sourceDomain,
      },
      title: row.title,
      excerpt: row.excerpt,
      retrievedAt: row.retrievedAt,
    });
    expect(result?.retrievedAt).not.toBe(row.retrievedAt);
  });

  it('restores absent optional source fields as undefined', async () => {
    const database = createDatabaseMock([{
      id: 'evidence-c2-2',
      sourceUrl: 'https://example.test/research/2',
      sourceTitle: null,
      sourceDomain: null,
      title: 'Pricing signal',
      excerpt: 'Respondents currently pay for manual help.',
      retrievedAt: storedAt,
    }]);
    const repository = new DrizzleEvidenceStoreRepository(database.db);

    const result = await repository.getById('evidence-c2-2');

    expect(result?.source).toEqual({ url: 'https://example.test/research/2' });
  });

  it('returns null when the id does not exist', async () => {
    const database = createDatabaseMock();
    const repository = new DrizzleEvidenceStoreRepository(database.db);

    await expect(repository.getById('missing')).resolves.toBeNull();
  });

  it('propagates duplicate-id failures without overwriting the existing record', async () => {
    const database = createDatabaseMock();
    const repository = new DrizzleEvidenceStoreRepository(database.db);
    const duplicateError = new Error('duplicate key value violates unique constraint');
    database.values.mockResolvedValueOnce(undefined).mockRejectedValueOnce(duplicateError);

    await repository.create(validEvidence());
    await expect(repository.create(validEvidence())).rejects.toBe(duplicateError);
    expect(database.values).toHaveBeenCalledTimes(2);
  });

  it('does not swallow insert or query failures', async () => {
    const insertDatabase = createDatabaseMock();
    const insertError = new Error('database unavailable');
    insertDatabase.values.mockRejectedValueOnce(insertError);
    const insertRepository = new DrizzleEvidenceStoreRepository(insertDatabase.db);

    await expect(insertRepository.create(validEvidence())).rejects.toBe(insertError);

    const queryDatabase = createDatabaseMock();
    const queryError = new Error('query failed');
    queryDatabase.limit.mockRejectedValueOnce(queryError);
    const queryRepository = new DrizzleEvidenceStoreRepository(queryDatabase.db);

    await expect(queryRepository.getById('evidence-c2-1')).rejects.toBe(queryError);
  });

  it('rejects invalid stored rows through the C2 evidence factory', async () => {
    const database = createDatabaseMock([{
      id: 'evidence-c2-invalid',
      sourceUrl: 'not-a-url',
      sourceTitle: null,
      sourceDomain: null,
      title: 'Invalid record',
      excerpt: 'Invalid source data must not be silently repaired.',
      retrievedAt: storedAt,
    }]);
    const repository = new DrizzleEvidenceStoreRepository(database.db);

    await expect(repository.getById('evidence-c2-invalid')).rejects.toThrow(
      'source.url must be an http(s) URL',
    );
  });
});
