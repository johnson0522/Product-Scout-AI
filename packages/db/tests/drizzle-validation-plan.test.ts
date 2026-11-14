import { describe, expect, it, vi } from 'vitest';
import { createValidationPlan, type ValidationPlan } from '@product-scout/domain';

import {
  DrizzleValidationPlanRepository,
  ValidationPlanPersistenceConflictError,
  validationPlans,
  type Database,
} from '../src';

type PlanRow = typeof validationPlans.$inferSelect;

describe('DrizzleValidationPlanRepository', () => {
  it('persists and rehydrates all seven days', async () => {
    const value = plan();
    const database = databaseMock(undefined, undefined, value.createdAt);
    const repository = new DrizzleValidationPlanRepository(database.db);
    await expect(repository.ensure(value)).resolves.toEqual(value);
    await expect(repository.findById(value.id)).resolves.toEqual(value);
  });

  it('reuses identical content and rejects changed content or identity per run', async () => {
    const value = plan();
    const repository = new DrizzleValidationPlanRepository(databaseMock(value).db);
    await expect(repository.ensure({ ...value, createdAt: new Date() })).resolves.toEqual(value);
    await expect(repository.ensure({
      ...value,
      days: [{ ...value.days[0], objective: 'Changed' }, ...value.days.slice(1)] as ValidationPlan['days'],
    })).rejects.toBeInstanceOf(ValidationPlanPersistenceConflictError);
    await expect(repository.ensure({
      ...value,
      id: '30000000-0000-5000-8000-000000000003',
    })).rejects.toBeInstanceOf(ValidationPlanPersistenceConflictError);
  });

  it('rereads an identical concurrent winner after insert failure', async () => {
    const value = plan();
    const repository = new DrizzleValidationPlanRepository(databaseMock(undefined, value).db);
    await expect(repository.ensure(value)).resolves.toEqual(value);
  });

  it('rejects invalid persisted day order through the domain factory', async () => {
    const value = plan();
    const row = toRow(value);
    row.days = [{ ...row.days[0]!, day: 2 }, ...row.days.slice(1)];
    const repository = new DrizzleValidationPlanRepository(databaseMockRow(row).db);
    await expect(repository.findById(value.id)).rejects.toThrow('expected day 1');
  });
});

function databaseMock(
  initial?: ValidationPlan,
  concurrent?: ValidationPlan,
  insertedCreatedAt: Date | undefined = initial?.createdAt ?? concurrent?.createdAt,
) {
  return databaseMockRow(
    initial === undefined ? undefined : toRow(initial),
    concurrent,
    insertedCreatedAt,
  );
}

function databaseMockRow(
  initial?: PlanRow,
  concurrent?: ValidationPlan,
  insertedCreatedAt?: Date,
) {
  let row = initial;
  let reads = 0;
  const select = vi.fn(() => ({
    from: () => ({
      where: () => ({
        limit: async () => {
          reads += 1;
          if (concurrent !== undefined && reads >= 2) row = toRow(concurrent);
          return row === undefined ? [] : [row];
        },
        then: (resolve: (value: readonly PlanRow[]) => unknown) =>
          resolve(row === undefined ? [] : [row]),
      }),
    }),
  }));
  const returning = vi.fn(async () => {
    if (concurrent !== undefined) throw new Error('duplicate key');
    return row === undefined ? [] : [row];
  });
  const values = vi.fn((value: Omit<PlanRow, 'createdAt' | 'updatedAt'>) => {
    if (insertedCreatedAt === undefined) throw new Error('Missing inserted createdAt fixture');
    row = { ...value, createdAt: insertedCreatedAt, updatedAt: insertedCreatedAt };
    return { returning };
  });
  return { db: { select, insert: vi.fn(() => ({ values })) } as unknown as Database };
}

function toRow(value: ValidationPlan): PlanRow {
  return {
    id: value.id,
    researchRunId: value.researchRunId,
    days: value.days.map((day) => ({
      ...day,
      activities: [...day.activities],
      successCriteria: [...day.successCriteria],
    })),
    createdAt: value.createdAt,
    updatedAt: value.createdAt,
  };
}

function plan(): ValidationPlan {
  return createValidationPlan({
    id: '10000000-0000-5000-8000-000000000001',
    researchRunId: '20000000-0000-4000-8000-000000000002',
    days: [day(1), day(2), day(3), day(4), day(5), day(6), day(7)],
    createdAt: new Date('2026-11-14T01:00:00.000Z'),
  });
}

function day(value: 1 | 2 | 3 | 4 | 5 | 6 | 7) {
  return {
    day: value,
    objective: `Validate assumption ${value}`,
    activities: [`Run activity ${value}`],
    successCriteria: [`Meet criterion ${value}`],
  };
}
