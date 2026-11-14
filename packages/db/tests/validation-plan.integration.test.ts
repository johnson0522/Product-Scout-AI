import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createValidationPlan } from '@product-scout/domain';

import {
  createDb,
  DrizzleValidationPlanRepository,
  projects,
  researchRuns,
  users,
} from '../src';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const authorized = process.env.PRODUCT_SCOUT_TEST_DATABASE === '1'
  && isDedicatedTestUrl(testDatabaseUrl);
const describeIntegration = authorized ? describe : describe.skip;
if (!authorized) console.warn('BLOCKED: ValidationPlan PostgreSQL integration requires the dedicated test database');

describeIntegration('DrizzleValidationPlanRepository PostgreSQL integration', () => {
  const ownerId = randomUUID();
  const projectId = randomUUID();
  const runId = randomUUID();
  let database: ReturnType<typeof createDb>;
  let repository: DrizzleValidationPlanRepository;

  beforeAll(async () => {
    database = createDb(testDatabaseUrl);
    repository = new DrizzleValidationPlanRepository(database.db);
    await database.db.insert(users).values({
      id: ownerId,
      email: `${ownerId}@validation-plan.example.test`,
      name: 'Validation plan owner',
    });
    await database.db.insert(projects).values({ id: projectId, ownerId, name: 'Plan test' });
    await database.db.insert(researchRuns).values({ id: runId, projectId, goal: 'Test plan' });
  });

  afterAll(async () => {
    await database.db.delete(researchRuns).where(eq(researchRuns.id, runId));
    await database.db.delete(projects).where(eq(projects.id, projectId));
    await database.db.delete(users).where(eq(users.id, ownerId));
    await database.client.end({ timeout: 5 });
  });

  it('round-trips seven days and reuses an identical replay', async () => {
    const value = createValidationPlan({
      id: randomUUID(),
      researchRunId: runId,
      days: [day(1), day(2), day(3), day(4), day(5), day(6), day(7)],
      createdAt: new Date('2026-11-14T01:02:03.456Z'),
    });
    await expect(repository.ensure(value)).resolves.toEqual(value);
    await expect(repository.ensure(value)).resolves.toEqual(value);
    await expect(repository.findById(value.id)).resolves.toEqual(value);
  });
});

function day(value: 1 | 2 | 3 | 4 | 5 | 6 | 7) {
  return {
    day: value,
    objective: `Validate assumption ${value}`,
    activities: [`Run activity ${value}`],
    successCriteria: [`Meet criterion ${value}`],
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
