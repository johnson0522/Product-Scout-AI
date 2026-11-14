import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray, like } from 'drizzle-orm';
import { createEvidence } from '@product-scout/evidence';

import {
  createDb,
  DrizzleEvidenceAcquisitionRepository,
  DrizzleEvidenceStoreRepository,
  evidenceAcquisitions,
  evidenceStore,
  projects,
  researchRuns,
  users,
} from '../src';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const authorized = process.env.PRODUCT_SCOUT_TEST_DATABASE === '1'
  && isDedicatedTestUrl(testDatabaseUrl);
const describeIntegration = authorized ? describe : describe.skip;

if (!authorized) {
  console.warn('BLOCKED: Evidence acquisition PostgreSQL tests require the dedicated test database');
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

describeIntegration('Evidence acquisition PostgreSQL integration', () => {
  const ownerId = randomUUID();
  const projectId = randomUUID();
  const runId = randomUUID();
  const otherRunId = randomUUID();
  const prefix = `acquisition-integration-${Date.now()}-`;
  let database: ReturnType<typeof createDb>;
  let acquisitions: DrizzleEvidenceAcquisitionRepository;
  let evidenceRepository: DrizzleEvidenceStoreRepository;

  beforeAll(async () => {
    database = createDb(testDatabaseUrl);
    acquisitions = new DrizzleEvidenceAcquisitionRepository(database.db);
    evidenceRepository = new DrizzleEvidenceStoreRepository(database.db);
    await database.db.insert(users).values({
      id: ownerId,
      email: `${prefix}owner@example.test`,
      name: 'Evidence acquisition owner',
    });
    await database.db.insert(projects).values({
      id: projectId,
      ownerId,
      name: 'Evidence acquisition project',
    });
    await database.db.insert(researchRuns).values([
      { id: runId, projectId, goal: 'Test acquisition idempotency' },
      { id: otherRunId, projectId, goal: 'Test cross-run reuse' },
    ]);
  });

  afterAll(async () => {
    await database.db.delete(evidenceAcquisitions)
      .where(inArray(evidenceAcquisitions.researchRunId, [runId, otherRunId]));
    await database.db.delete(evidenceStore).where(like(evidenceStore.id, `${prefix}%`));
    await database.db.delete(researchRuns)
      .where(inArray(researchRuns.id, [runId, otherRunId]));
    await database.db.delete(projects).where(inArray(projects.id, [projectId]));
    await database.db.delete(users).where(inArray(users.id, [ownerId]));
    await database.client.end({ timeout: 5 });
  });

  it('resolves concurrent replay to one acquisition without orphan Evidence', async () => {
    const first = evidence(`${prefix}race-a`, 'First');
    const second = evidence(`${prefix}race-b`, 'Second');
    const scope = {
      researchRunId: runId,
      workflowInvocationKey: `${prefix}race`,
      stepId: 'market_understanding' as const,
      sourceFingerprint: `sha256:${'a'.repeat(64)}`,
      capturedAt: first.retrievedAt,
    };

    const results = await Promise.all([
      acquisitions.acquire({ ...scope, evidence: first }),
      acquisitions.acquire({ ...scope, evidence: second }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(['created', 'existing']);
    expect(new Set(results.map((result) => result.evidence.id)).size).toBe(1);
    const losingId = results[0]?.evidence.id === first.id ? second.id : first.id;
    await expect(evidenceRepository.getById(losingId)).resolves.toBeNull();
    await expect(acquisitions.listByResearchRunId(runId)).resolves.toHaveLength(1);
  });

  it('explicitly associates the same Evidence with another ResearchRun', async () => {
    const original = evidence(`${prefix}shared`, 'Shared');
    const first = await acquisitions.acquire({
      ...scope(runId, `${prefix}shared-run`, 'b'),
      evidence: original,
    });
    const second = await acquisitions.acquire({
      ...scope(otherRunId, `${prefix}shared-other-run`, 'b'),
      evidence: original,
    });

    expect(first.evidence.id).toBe(second.evidence.id);
    await expect(acquisitions.isAssociatedWithResearchRun(runId, original.id))
      .resolves.toBe(true);
    await expect(acquisitions.isAssociatedWithResearchRun(otherRunId, original.id))
      .resolves.toBe(true);
  });

  it('does not merge the same URL when content fingerprints differ', async () => {
    const first = evidence(`${prefix}version-1`, 'Version one');
    const second = evidence(`${prefix}version-2`, 'Version two');

    const results = await Promise.all([
      acquisitions.acquire({
        ...scope(runId, `${prefix}versions`, 'c'),
        evidence: first,
      }),
      acquisitions.acquire({
        ...scope(runId, `${prefix}versions`, 'd'),
        evidence: second,
      }),
    ]);

    expect(results.map((result) => result.status)).toEqual(['created', 'created']);
    expect(results.map((result) => result.evidence.id)).toEqual([first.id, second.id]);
  });

  it('rolls back Evidence when the acquisition foreign key fails', async () => {
    const orphan = evidence(`${prefix}rollback`, 'Rollback');

    await expect(acquisitions.acquire({
      ...scope(randomUUID(), `${prefix}missing-run`, 'e'),
      evidence: orphan,
    })).rejects.toBeDefined();
    await expect(evidenceRepository.getById(orphan.id)).resolves.toBeNull();
  });

  function evidence(id: string, title: string) {
    return createEvidence({
      id,
      source: { url: 'https://example.test/shared' },
      title,
      excerpt: `${title} excerpt`,
      retrievedAt: new Date('2026-11-14T04:05:06.789Z'),
    });
  }

  function scope(researchRunId: string, invocation: string, character: string) {
    return {
      researchRunId,
      workflowInvocationKey: invocation,
      stepId: 'market_understanding' as const,
      sourceFingerprint: `sha256:${character.repeat(64)}`,
      capturedAt: new Date('2026-11-14T04:05:06.789Z'),
    };
  }
});

