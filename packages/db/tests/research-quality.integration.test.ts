import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ResearchQualitySnapshotConflictError } from '@product-scout/evidence';
import { qualitySnapshotFixture } from '../../../tests/fixtures/research-quality';
import { createDb, DrizzleResearchQualitySnapshotRepository, researchQualitySnapshots, researchFindings, researchRuns, projects, users } from '../src';

function dedicated(value: string | undefined): value is string {
  try { const u = new URL(value ?? ''); return u.protocol === 'postgresql:' && ['127.0.0.1', 'localhost'].includes(u.hostname) && u.port === '55432' && u.pathname === '/product_scout_test'; }
  catch { return false; }
}
const url = process.env.TEST_DATABASE_URL;
const allowed = process.env.PRODUCT_SCOUT_TEST_DATABASE === '1' && dedicated(url);
if (!allowed) console.warn('BLOCKED: Quality snapshot integration requires the dedicated test database');

(allowed ? describe : describe.skip)('Drizzle quality snapshots on PostgreSQL', () => {
  const owner = randomUUID(); const project = randomUUID(); const run = randomUUID();
  const finding = `quality-${randomUUID()}`;
  let database: ReturnType<typeof createDb>;
  let repository: DrizzleResearchQualitySnapshotRepository;
  const value = qualitySnapshotFixture({ researchRunId: run, findingId: finding });
  beforeAll(async () => {
    database = createDb(url);
    repository = new DrizzleResearchQualitySnapshotRepository(database.db);
    await database.db.insert(users).values({ id: owner, email: `${owner}@quality.test`, name: 'Quality test' });
    await database.db.insert(projects).values({ id: project, ownerId: owner, name: 'Quality' });
    await database.db.insert(researchRuns).values({ id: run, projectId: project, goal: 'Quality snapshots' });
    await database.db.insert(researchFindings).values({ id: finding, researchRunId: run, type: 'insight', title: 'Quality fixture', description: 'Repository fixture', createdAt: new Date() });
  });
  afterAll(async () => {
    if (!database) return;
    await database.db.delete(users).where(eq(users.id, owner));
    await database.client.end({ timeout: 5 });
  });
  it('persists and reads full diagnostics with the original timestamp on identical replay', async () => {
    expect(await repository.ensure(value)).toEqual(value);
    expect(await repository.ensure({ ...value, assessedAt: new Date() })).toEqual(value);
    expect(await repository.listByResearchRunId(run)).toEqual([value]);
    expect(await repository.listByResearchRunId(randomUUID())).toEqual([]);
  });
  it('rejects a changed assessment without overwriting the original', async () => {
    await repository.ensure(value);
    const changed = { ...value, inputs: value.inputs.map((input) => ({ ...input, sourceKind: 'first_party' as const })) };
    await expect(repository.ensure(changed)).rejects.toBeInstanceOf(ResearchQualitySnapshotConflictError);
    expect(await repository.listByResearchRunId(run)).toEqual([value]);
  });
  it('prevents cross-run association and enforces the Finding foreign key', async () => {
    await expect(repository.ensure({ ...value, researchRunId: randomUUID() })).rejects.toThrow('does not belong');
    await expect(database.db.insert(researchQualitySnapshots).values({ findingId: `missing-${randomUUID()}`,
      workflowInvocationKey: value.workflowInvocationKey, rulesVersion: value.rulesVersion, assessedAt: value.assessedAt,
      inputs: value.inputs, assessment: value.assessment })).rejects.toMatchObject({ code: '23503' });
  });
  it('validates stored JSON and propagates query/connection errors', async () => {
    await repository.ensure(value);
    await database.client`update research_quality_snapshots set assessment='{}'::jsonb where finding_id=${finding}`;
    try { await expect(repository.listByResearchRunId(run)).rejects.toThrow('Invalid research quality snapshot'); }
    finally { await database.db.update(researchQualitySnapshots).set({ assessment: value.assessment }).where(eq(researchQualitySnapshots.findingId, finding)); }
    const closed = createDb(url); await closed.client.end({ timeout: 1 });
    await expect(new DrizzleResearchQualitySnapshotRepository(closed.db).listByResearchRunId(run)).rejects.toThrow();
  });
  it('retains immutable snapshots for different workflow invocations', async () => {
    await repository.ensure({ ...value, workflowInvocationKey: 'second-invocation' });
    expect(await repository.listByResearchRunId(run)).toHaveLength(2);
  });
});
