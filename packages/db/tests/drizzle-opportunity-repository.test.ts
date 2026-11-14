import { describe, expect, it, vi } from 'vitest';
import { calculateOpportunityScore, type Opportunity } from '@product-scout/domain';

import {
  DrizzleOpportunityRepository,
  OpportunityPersistenceConflictError,
  opportunities,
  opportunityScores,
  type Database,
} from '../src';

type OpportunityRow = typeof opportunities.$inferSelect;
type ScoreRow = typeof opportunityScores.$inferSelect;

describe('DrizzleOpportunityRepository', () => {
  it('writes Opportunity and Score atomically and round-trips explanations', async () => {
    const database = databaseMock();
    const repository = new DrizzleOpportunityRepository(database.db);
    const value = opportunity();

    await expect(repository.ensure(value)).resolves.toEqual(value);
    expect(database.transaction).toHaveBeenCalledTimes(1);
    await expect(repository.findById(value.id)).resolves.toEqual(value);
  });

  it('reuses an identical replay without writing and rejects conflicting content', async () => {
    const value = opportunity();
    const database = databaseMock(value);
    const repository = new DrizzleOpportunityRepository(database.db);

    await expect(repository.ensure(value)).resolves.toEqual(value);
    expect(database.transaction).not.toHaveBeenCalled();
    await expect(repository.ensure({ ...value, title: 'Changed title' }))
      .rejects.toBeInstanceOf(OpportunityPersistenceConflictError);
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('rereads and reuses an identical concurrent winner after an insert failure', async () => {
    const value = opportunity();
    const database = databaseMock(undefined, value);
    const repository = new DrizzleOpportunityRepository(database.db);

    await expect(repository.ensure(value)).resolves.toEqual(value);
    expect(database.transaction).toHaveBeenCalledTimes(1);
  });
});

function databaseMock(initial?: Opportunity, concurrent?: Opportunity) {
  let opportunityRow = initial === undefined ? undefined : toRows(initial).opportunity;
  let scoreRow = initial === undefined ? undefined : toRows(initial).score;
  let selectCount = 0;
  const select = vi.fn(() => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: async () => {
          selectCount += 1;
          if (concurrent !== undefined && selectCount >= 2 && opportunityRow === undefined) {
            const rows = toRows(concurrent);
            opportunityRow = rows.opportunity;
            scoreRow = rows.score;
          }
          return table === opportunities
            ? (opportunityRow === undefined ? [] : [opportunityRow])
            : (scoreRow === undefined ? [] : [scoreRow]);
        },
      }),
    }),
  }));
  const insert = vi.fn((table: unknown) => ({
    values: (candidate: unknown) => {
      if (concurrent !== undefined && opportunityRow === undefined) {
        return { returning: async () => { throw new Error('duplicate key'); } };
      }
      if (table === opportunities) {
        const value = candidate as Omit<OpportunityRow, 'createdAt' | 'updatedAt'>;
        opportunityRow = {
          ...value,
          createdAt: new Date('2026-11-14T00:00:00.000Z'),
          updatedAt: new Date('2026-11-14T00:00:00.000Z'),
        };
        return { returning: async () => [opportunityRow!] };
      }
      const value = candidate as Omit<ScoreRow, 'id' | 'createdAt' | 'updatedAt'>;
      scoreRow = {
        id: '20000000-0000-4000-8000-000000000002',
        ...value,
        createdAt: new Date('2026-11-14T00:00:00.000Z'),
        updatedAt: new Date('2026-11-14T00:00:00.000Z'),
      };
      return Promise.resolve();
    },
  }));
  const transaction = vi.fn(async (callback: (transaction: unknown) => Promise<unknown>) =>
    callback({ insert }));
  return {
    db: { select, transaction } as unknown as Database,
    transaction,
  };
}

function toRows(value: Opportunity): { opportunity: OpportunityRow; score: ScoreRow } {
  const timestamp = new Date('2026-11-14T00:00:00.000Z');
  return {
    opportunity: {
      id: value.id,
      researchRunId: value.researchRunId,
      title: value.title,
      targetCustomer: value.targetCustomer,
      problem: value.problem,
      evidenceIds: [...value.evidenceIds],
      solution: value.solution,
      whyNow: value.whyNow,
      monetization: value.monetization,
      mvp: value.mvp,
      confidence: value.confidence,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    score: {
      id: '20000000-0000-4000-8000-000000000002',
      opportunityId: value.id,
      total: value.score.total,
      breakdown: value.score.breakdown,
      reasoning: value.scoreReasoning,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  };
}

function opportunity(): Opportunity {
  return {
    id: '10000000-0000-5000-8000-000000000001',
    researchRunId: '30000000-0000-4000-8000-000000000003',
    title: 'Reconciliation assistant',
    targetCustomer: 'Operations teams',
    problem: 'Recurring reconciliation work',
    evidenceIds: ['evidence-1'],
    solution: 'Assisted workflow',
    whyNow: 'Operational complexity is increasing',
    monetization: 'Subscription',
    mvp: 'Import, reconcile, export',
    confidence: 80,
    score: calculateOpportunityScore({
      pain: 80,
      willingnessToPay: 70,
      frequency: 75,
      market: 65,
      competition: 60,
      acquisition: 70,
      feasibility: 85,
    }),
    scoreReasoning: {
      pain: 'pain',
      willingnessToPay: 'willingness',
      frequency: 'frequency',
      market: 'market',
      competition: 'competition',
      acquisition: 'acquisition',
      feasibility: 'feasibility',
    },
  };
}
