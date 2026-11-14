import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createResearchReport } from '@product-scout/domain';

import {
  createDb,
  DrizzleResearchReportRepository,
  projects,
  researchRuns,
  users,
} from '../src';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const authorized = process.env.PRODUCT_SCOUT_TEST_DATABASE === '1'
  && isDedicatedTestUrl(testDatabaseUrl);
const describeIntegration = authorized ? describe : describe.skip;
if (!authorized) console.warn('BLOCKED: ResearchReport PostgreSQL integration requires the dedicated test database');

describeIntegration('DrizzleResearchReportRepository PostgreSQL integration', () => {
  const ownerId = randomUUID();
  const projectId = randomUUID();
  const runId = randomUUID();
  let database: ReturnType<typeof createDb>;
  let repository: DrizzleResearchReportRepository;

  beforeAll(async () => {
    database = createDb(testDatabaseUrl);
    repository = new DrizzleResearchReportRepository(database.db);
    await database.db.insert(users).values({
      id: ownerId,
      email: `${ownerId}@report.example.test`,
      name: 'Report integration owner',
    });
    await database.db.insert(projects).values({ id: projectId, ownerId, name: 'Report test' });
    await database.db.insert(researchRuns).values({ id: runId, projectId, goal: 'Test report' });
  });

  afterAll(async () => {
    await database.db.delete(researchRuns).where(eq(researchRuns.id, runId));
    await database.db.delete(projects).where(eq(projects.id, projectId));
    await database.db.delete(users).where(eq(users.id, ownerId));
    await database.client.end({ timeout: 5 });
  });

  it('round-trips a report and reuses an identical replay', async () => {
    const value = createResearchReport({
      id: randomUUID(),
      researchRunId: runId,
      title: 'Research report',
      executiveSummary: 'Evidence supports a focused opportunity.',
      sections: [{
        id: 'findings',
        title: 'Findings',
        content: 'Teams report recurring work.',
        findingIds: ['finding-1'],
        opportunityIds: [],
      }],
      limitations: ['No pricing interview was conducted.'],
      createdAt: new Date('2026-11-14T01:02:03.456Z'),
    });
    await expect(repository.ensure(value)).resolves.toEqual(value);
    await expect(repository.ensure(value)).resolves.toEqual(value);
    await expect(repository.findById(value.id)).resolves.toEqual(value);
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
