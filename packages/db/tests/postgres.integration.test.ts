import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { and, eq, like, sql } from 'drizzle-orm';
import { createEvidence } from '@product-scout/evidence';

import {
  createDb,
  DrizzleEvidenceStoreRepository,
  evidenceStore,
  type Database,
} from '../src';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseAuthorized = process.env.PRODUCT_SCOUT_TEST_DATABASE === '1'
  && isDedicatedTestUrl(testDatabaseUrl);

if (!testDatabaseAuthorized) {
  console.warn('BLOCKED: PostgreSQL integration tests require PRODUCT_SCOUT_TEST_DATABASE=1 and a dedicated TEST_DATABASE_URL');
}

const describeIntegration = testDatabaseAuthorized ? describe : describe.skip;
const evidencePrefix = `db-integration-${Date.now()}-`;

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

function evidence(id: string, optionalSourceFields = true) {
  return createEvidence({
    id,
    source: {
      url: `https://example.test/${id}`,
      ...(optionalSourceFields
        ? { title: 'Integration source', domain: 'example.test' }
        : {}),
    },
    title: 'Integration evidence',
    excerpt: 'Evidence persisted by the real Drizzle repository.',
    retrievedAt: new Date('2026-06-01T12:34:56.789Z'),
  });
}

describeIntegration('DrizzleEvidenceStoreRepository PostgreSQL integration', () => {
  let database: ReturnType<typeof createDb>;
  let repository: DrizzleEvidenceStoreRepository;

  beforeAll(async () => {
    database = createDb(testDatabaseUrl);
    repository = new DrizzleEvidenceStoreRepository(database.db);
    const table = await database.db.execute(sql`select to_regclass('public.evidence_store') as name`);
    expect(table[0]?.name).toBe('evidence_store');
  });

  afterAll(async () => {
    await database.db.delete(evidenceStore).where(like(evidenceStore.id, `${evidencePrefix}%`));
    await database.client.end({ timeout: 5 });
  });

  it('creates and reads every Evidence field with timestamptz semantics', async () => {
    const original = evidence(`${evidencePrefix}full`);
    await repository.create(original);

    const loaded = await repository.getById(original.id);

    expect(loaded).toEqual(original);
    expect(loaded?.retrievedAt.getTime()).toBe(original.retrievedAt.getTime());
  });

  it('round-trips NULL optional source fields as omitted domain fields', async () => {
    const original = evidence(`${evidencePrefix}optional`, false);
    await repository.create(original);

    const loaded = await repository.getById(original.id);

    expect(loaded).toEqual(original);
    expect(loaded?.source).toEqual({ url: original.source.url });
  });

  it('rejects duplicate IDs without overwriting the first row', async () => {
    const original = evidence(`${evidencePrefix}duplicate`);
    await repository.create(original);
    const replacement = createEvidence({
      ...original,
      title: 'Replacement must not overwrite',
    });

    await expect(repository.create(replacement)).rejects.toBeDefined();
    await expect(repository.getById(original.id)).resolves.toEqual(original);
  });

  it('returns null for an unknown ID', async () => {
    await expect(repository.getById(`${evidencePrefix}missing`)).resolves.toBeNull();
  });

  it('revalidates rows read from PostgreSQL through createEvidence', async () => {
    const invalidId = `${evidencePrefix}invalid`;
    await database.db.insert(evidenceStore).values({
      id: invalidId,
      sourceUrl: 'not-a-url',
      sourceTitle: null,
      sourceDomain: null,
      title: 'Invalid stored row',
      excerpt: 'This row violates the domain URL invariant.',
      retrievedAt: new Date('2026-06-01T12:34:56.789Z'),
    });

    await expect(repository.getById(invalidId)).rejects.toThrow('source.url must be an http(s) URL');
  });

  it('keeps the legacy evidence table present after migration', async () => {
    const table = await database.db.execute(sql`select to_regclass('public.evidence') as name`);
    expect(table[0]?.name).toBe('evidence');
  });
});