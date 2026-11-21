import { describe, expect, it, vi } from 'vitest';

import {
  DrizzleResearchStepRepository,
  researchSteps,
  type Database,
} from '../src';

type StepRow = typeof researchSteps.$inferSelect;

describe('DrizzleResearchStepRepository', () => {
  it('records running and completed progress through one upsert identity', async () => {
    const database = databaseMock();
    const repository = new DrizzleResearchStepRepository(database.db);
    const base = {
      id: '10000000-0000-5000-8000-000000000001',
      researchRunId: '20000000-0000-4000-8000-000000000002',
      type: 'market_understanding' as const,
    };

    await repository.record({
      ...base,
      status: 'running',
      occurredAt: new Date('2026-11-16T01:02:03.456Z'),
    });
    await repository.record({
      ...base,
      status: 'completed',
      occurredAt: new Date('2026-11-16T01:03:04.567Z'),
    });

    expect(database.values).toHaveBeenCalledTimes(2);
    expect(database.onConflictDoUpdate).toHaveBeenCalledTimes(2);
    expect(database.onConflictDoUpdate.mock.calls[1]?.[0]).toMatchObject({
      target: [researchSteps.researchRunId, researchSteps.type],
      set: { status: 'completed' },
    });
  });

  it('hydrates stored business progress and lists it by run', async () => {
    const row = stepRow();
    const database = databaseMock(row);
    const repository = new DrizzleResearchStepRepository(database.db);

    await expect(repository.findById(row.id)).resolves.toEqual({
      id: row.id,
      researchRunId: row.researchRunId,
      type: row.type,
      status: row.status,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      errorMessage: undefined,
    });
    await expect(repository.listByResearchRunId(row.researchRunId)).resolves.toEqual([
      expect.objectContaining({ id: row.id, status: 'completed' }),
    ]);
  });
});

function databaseMock(row?: StepRow) {
  const onConflictDoUpdate = vi.fn(async () => undefined);
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const limit = vi.fn(async () => row === undefined ? [] : [row]);
  const orderBy = vi.fn(async () => row === undefined ? [] : [row]);
  const where = vi.fn(() => ({ limit, orderBy }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const insert = vi.fn(() => ({ values }));
  return {
    db: { select, insert } as unknown as Database,
    values,
    onConflictDoUpdate,
  };
}

function stepRow(): StepRow {
  const startedAt = new Date('2026-11-16T01:02:03.456Z');
  return {
    id: '10000000-0000-5000-8000-000000000001',
    researchRunId: '20000000-0000-4000-8000-000000000002',
    type: 'market_understanding',
    status: 'completed',
    startedAt,
    completedAt: new Date('2026-11-16T01:03:04.567Z'),
    errorMessage: null,
    createdAt: startedAt,
    updatedAt: startedAt,
  };
}
