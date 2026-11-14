import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calculateOpportunityScore, type Opportunity } from '@product-scout/domain';
import { eq } from 'drizzle-orm';

import {
  createDb,
  DrizzleOpportunityRepository,
  OpportunityPersistenceConflictError,
  opportunities,
  projects,
  researchRuns,
  users,
} from '../src';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const authorized = process.env.PRODUCT_SCOUT_TEST_DATABASE === '1'
  && isDedicatedTestUrl(testDatabaseUrl);
const describeIntegration = authorized ? describe : describe.skip;

if (!authorized) {
  console.warn('BLOCKED: Opportunity PostgreSQL integration requires the dedicated test database');
}

describeIntegration('DrizzleOpportunityRepository PostgreSQL integration', () => {
  const ownerId = randomUUID();
  const projectId = randomUUID();
  const runId = randomUUID();
  let database: ReturnType<typeof createDb>;
  let repository: DrizzleOpportunityRepository;

  beforeAll(async () => {
    database = createDb(testDatabaseUrl);
    repository = new DrizzleOpportunityRepository(database.db);
    await database.db.insert(users).values({
      id: ownerId,
      email: `${ownerId}@opportunity.example.test`,
      name: 'Opportunity integration owner',
    });
    await database.db.insert(projects).values({ id: projectId, ownerId, name: 'Opportunity test' });
    await database.db.insert(researchRuns).values({ id: runId, projectId, goal: 'Test opportunities' });
  });

  afterAll(async () => {
    await database.db.delete(researchRuns).where(eq(researchRuns.id, runId));
    await database.db.delete(projects).where(eq(projects.id, projectId));
    await database.db.delete(users).where(eq(users.id, ownerId));
    await database.client.end({ timeout: 5 });
  });

  it('round-trips score explanations and reuses an identical replay', async () => {
    const value = opportunity(runId, randomUUID());
    const created = await repository.ensure(value);
    const replay = await repository.ensure(value);

    expect(created).toEqual(value);
    expect(replay).toEqual(value);
    expect(await repository.findById(value.id)).toEqual(value);
  });

  it('rejects conflicting content without overwriting the stored aggregate', async () => {
    const value = opportunity(runId, randomUUID());
    await repository.ensure(value);
    await expect(repository.ensure({ ...value, title: 'Conflicting title' }))
      .rejects.toBeInstanceOf(OpportunityPersistenceConflictError);
    await expect(repository.findById(value.id)).resolves.toEqual(value);
  });

  it('converges concurrent identical inserts to one Opportunity and one Score', async () => {
    const value = opportunity(runId, randomUUID());
    const results = await Promise.all([
      repository.ensure(value),
      repository.ensure(value),
    ]);
    expect(results).toEqual([value, value]);
    const stored = await database.db.select().from(opportunities);
    expect(stored.filter((row) => row.id === value.id)).toHaveLength(1);
  });
});

function opportunity(researchRunId: string, id: string): Opportunity {
  const score = calculateOpportunityScore({
    pain: 80,
    willingnessToPay: 70,
    frequency: 75,
    market: 65,
    competition: 60,
    acquisition: 70,
    feasibility: 85,
  });
  return {
    id,
    researchRunId,
    title: 'Reconciliation assistant',
    targetCustomer: 'Operations teams',
    problem: 'Recurring reconciliation work',
    evidenceIds: ['evidence-1', 'evidence-2'],
    solution: 'Assisted reconciliation workflow',
    whyNow: 'Operational complexity is increasing',
    monetization: 'Monthly subscription',
    mvp: 'Import, reconcile, and export',
    score,
    scoreReasoning: {
      pain: 'Multiple sources report material pain.',
      willingnessToPay: 'Saved labor supports willingness to pay.',
      frequency: 'The workflow recurs regularly.',
      market: 'The target role exists across industries.',
      competition: 'Existing tools leave a workflow gap.',
      acquisition: 'The audience has reachable communities.',
      feasibility: 'The scoped workflow is technically feasible.',
    },
    confidence: 80,
  };
}

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
