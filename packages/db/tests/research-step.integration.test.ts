import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import {
  createDb,
  DrizzleResearchRunRepository,
  DrizzleResearchStepRepository,
  projects,
  researchRuns,
  users,
} from '../src';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const authorized = process.env.PRODUCT_SCOUT_TEST_DATABASE === '1'
  && isDedicatedTestUrl(testDatabaseUrl);
const describeIntegration = authorized ? describe : describe.skip;
if (!authorized) {
  console.warn('BLOCKED: ResearchStep PostgreSQL integration requires the dedicated test database');
}

describeIntegration('DrizzleResearchStepRepository PostgreSQL integration', () => {
  const ownerId = randomUUID();
  const projectId = randomUUID();
  const runId = randomUUID();
  const stepId = randomUUID();
  let database: ReturnType<typeof createDb>;
  let steps: DrizzleResearchStepRepository;
  let runs: DrizzleResearchRunRepository;

  beforeAll(async () => {
    database = createDb(testDatabaseUrl);
    steps = new DrizzleResearchStepRepository(database.db);
    runs = new DrizzleResearchRunRepository(database.db);
    await database.db.insert(users).values({
      id: ownerId,
      email: `${ownerId}@step.example.test`,
      name: 'Step progress owner',
    });
    await database.db.insert(projects).values({ id: projectId, ownerId, name: 'Step progress' });
    await database.db.insert(researchRuns).values({ id: runId, projectId, goal: 'Track progress' });
  });

  afterAll(async () => {
    await database.db.delete(researchRuns).where(eq(researchRuns.id, runId));
    await database.db.delete(projects).where(eq(projects.id, projectId));
    await database.db.delete(users).where(eq(users.id, ownerId));
    await database.client.end({ timeout: 5 });
  });

  it('upserts one business step and exposes it through ResearchRun', async () => {
    const startedAt = new Date('2026-11-16T01:02:03.456Z');
    const completedAt = new Date('2026-11-16T01:03:04.567Z');
    await steps.record({
      id: stepId,
      researchRunId: runId,
      type: 'market_understanding',
      status: 'running',
      occurredAt: startedAt,
    });
    await steps.record({
      id: stepId,
      researchRunId: runId,
      type: 'market_understanding',
      status: 'completed',
      occurredAt: completedAt,
    });

    await expect(steps.findById(stepId)).resolves.toEqual({
      id: stepId,
      researchRunId: runId,
      type: 'market_understanding',
      status: 'completed',
      startedAt,
      completedAt,
      errorMessage: undefined,
    });
    expect((await runs.findById(runId))?.steps).toEqual([
      expect.objectContaining({ id: stepId, status: 'completed' }),
    ]);
    await expect(steps.listByResearchRunId(runId)).resolves.toHaveLength(1);
  });
});

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
