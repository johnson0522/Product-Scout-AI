import { describe, expect, it, vi } from 'vitest';
import { createEvidence } from '@product-scout/evidence';

import {
  DrizzleEvidenceAcquisitionRepository,
  evidenceAcquisitions,
  evidenceStore,
  type Database,
} from '../src';

type EvidenceRow = typeof evidenceStore.$inferSelect;
type AcquisitionRow = typeof evidenceAcquisitions.$inferSelect;

const evidence = createEvidence({
  id: 'evidence-acquisition-1',
  source: { url: 'https://example.test/research' },
  title: 'Research result',
  excerpt: 'Teams repeat manual work.',
  retrievedAt: new Date('2026-11-14T01:02:03.456Z'),
});
const acquisitionRow: AcquisitionRow = {
  id: '10000000-0000-4000-8000-000000000001',
  researchRunId: '20000000-0000-4000-8000-000000000002',
  evidenceId: evidence.id,
  workflowInvocationKey: 'invocation-1',
  stepId: 'market_understanding',
  sourceFingerprint: `sha256:${'a'.repeat(64)}`,
  capturedAt: evidence.retrievedAt,
};
const evidenceRow: EvidenceRow = {
  id: evidence.id,
  sourceUrl: evidence.source.url,
  sourceTitle: null,
  sourceDomain: null,
  title: evidence.title,
  excerpt: evidence.excerpt,
  retrievedAt: evidence.retrievedAt,
};

function input() {
  return {
    evidence,
    researchRunId: acquisitionRow.researchRunId,
    workflowInvocationKey: acquisitionRow.workflowInvocationKey,
    stepId: acquisitionRow.stepId,
    sourceFingerprint: acquisitionRow.sourceFingerprint,
    capturedAt: acquisitionRow.capturedAt,
  };
}

function databaseMock(options: {
  readonly acquisitionRows?: readonly AcquisitionRow[];
  readonly evidenceRows?: readonly EvidenceRow[];
  readonly insertEvidence?: boolean;
  readonly insertAcquisition?: boolean;
  readonly firstAcquisitionReadEmpty?: boolean;
} = {}) {
  const acquisitionRows = options.acquisitionRows ?? [];
  const evidenceRows = options.evidenceRows ?? [];
  let acquisitionReadCount = 0;
  const select = vi.fn(() => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: async () => {
          if (table !== evidenceAcquisitions) return evidenceRows;
          acquisitionReadCount += 1;
          return options.firstAcquisitionReadEmpty === true && acquisitionReadCount === 1
            ? []
            : acquisitionRows;
        },
      }),
    }),
  }));
  const insert = vi.fn((table: unknown) => ({
    values: () => ({
      onConflictDoNothing: () => ({
        returning: async () => table === evidenceStore
          ? (options.insertEvidence === false ? [] : [{ id: evidence.id }])
          : (options.insertAcquisition === false ? [] : [acquisitionRow]),
      }),
    }),
  }));
  const transaction = vi.fn(async (callback: (transaction: unknown) => Promise<unknown>) =>
    callback({ select, insert }));
  return {
    db: { select, insert, transaction } as unknown as Database,
    insert,
  };
}

describe('DrizzleEvidenceAcquisitionRepository', () => {
  it('creates Evidence and its acquisition in one transaction', async () => {
    const database = databaseMock();
    const repository = new DrizzleEvidenceAcquisitionRepository(database.db);

    const result = await repository.acquire(input());

    expect(result).toMatchObject({
      status: 'created',
      evidence: { id: evidence.id },
      acquisition: { id: acquisitionRow.id, evidenceId: evidence.id },
    });
    expect(database.insert).toHaveBeenCalledWith(evidenceStore);
    expect(database.insert).toHaveBeenCalledWith(evidenceAcquisitions);
  });

  it('returns an existing scoped acquisition without new inserts', async () => {
    const database = databaseMock({
      acquisitionRows: [acquisitionRow],
      evidenceRows: [evidenceRow],
    });
    const repository = new DrizzleEvidenceAcquisitionRepository(database.db);

    const result = await repository.acquire(input());

    expect(result.status).toBe('existing');
    expect(result.evidence).toEqual(evidence);
    expect(database.insert).not.toHaveBeenCalled();
  });

  it('rolls back a race path and reads the winning scoped acquisition', async () => {
    const database = databaseMock({
      acquisitionRows: [acquisitionRow],
      evidenceRows: [evidenceRow],
      insertAcquisition: false,
      firstAcquisitionReadEmpty: true,
    });
    const repository = new DrizzleEvidenceAcquisitionRepository(database.db);

    await expect(repository.acquire(input())).resolves.toMatchObject({
      status: 'existing',
      acquisition: { id: acquisitionRow.id },
    });
  });
});

