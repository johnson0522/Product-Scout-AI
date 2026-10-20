import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEvidence } from '@product-scout/evidence';
import {
  createDb,
  DrizzleClaimRepository,
  DrizzleEvidenceStoreRepository,
  DrizzleResearchFindingRepository,
  evidenceStore,
  projects,
  researchRuns,
  users,
} from '@product-scout/db';

import {
  ClaimResearchRunMismatchError,
  ReferencedEvidenceNotFoundError,
  ResearchFindingService,
} from '../src';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const authorized = process.env.PRODUCT_SCOUT_TEST_DATABASE === '1'
  && isDedicatedTestUrl(testDatabaseUrl);
const describeIntegration = authorized ? describe : describe.skip;

if (!authorized) {
  console.warn('BLOCKED: Research Finding integration requires the dedicated test database');
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

describeIntegration('ResearchFindingService with PostgreSQL repositories', () => {
  const ownerId = randomUUID();
  const projectId = randomUUID();
  const runId = randomUUID();
  const otherRunId = randomUUID();
  const prefix = 'd1-service-' + Date.now() + '-';
  let database: ReturnType<typeof createDb>;
  let service: ResearchFindingService;

  beforeAll(async () => {
    database = createDb(testDatabaseUrl);
    const evidenceRepository = new DrizzleEvidenceStoreRepository(database.db);
    service = new ResearchFindingService(
      evidenceRepository,
      new DrizzleClaimRepository(database.db),
      new DrizzleResearchFindingRepository(database.db),
    );

    await database.db.insert(users).values({
      id: ownerId,
      email: prefix + 'owner@example.test',
      name: 'D1 service integration owner',
    });
    await database.db.insert(projects).values({
      id: projectId,
      ownerId,
      name: 'D1 service integration project',
    });
    await database.db.insert(researchRuns).values([
      { id: runId, projectId, goal: 'Trace findings to evidence' },
      { id: otherRunId, projectId, goal: 'Reject cross-run claims' },
    ]);
    await evidenceRepository.create(createEvidence({
      id: prefix + 'evidence',
      source: { url: 'https://example.test/d1-service-source' },
      title: 'D1 application service evidence',
      excerpt: 'Teams report recurring manual reconciliation work.',
      retrievedAt: new Date('2026-10-19T06:07:08.901Z'),
    }));
  });

  afterAll(async () => {
    await database.client.unsafe(
      'delete from research_finding_claims where finding_id in (select id from research_findings where research_run_id in ($1, $2))',
      [runId, otherRunId],
    );
    await database.client.unsafe(
      'delete from research_findings where research_run_id in ($1, $2)',
      [runId, otherRunId],
    );
    await database.client.unsafe(
      'delete from claim_evidence_refs where claim_id in (select id from claims where research_run_id in ($1, $2))',
      [runId, otherRunId],
    );
    await database.client.unsafe(
      'delete from claims where research_run_id in ($1, $2)',
      [runId, otherRunId],
    );
    await database.client.unsafe(
      'delete from research_runs where project_id = $1',
      [projectId],
    );
    await database.client.unsafe(
      'delete from evidence_store where id like $1',
      [prefix + '%'],
    );
    await database.client.unsafe('delete from projects where id = $1', [projectId]);
    await database.client.unsafe('delete from users where id = $1', [ownerId]);
    await database.client.end({ timeout: 5 });
  });

  it('persists and traces Finding to the original Evidence source URL', async () => {
    const claim = await service.createClaim({
      id: prefix + 'claim',
      researchRunId: runId,
      text: 'Manual reconciliation is a recurring workflow burden.',
      evidenceRefs: [{ evidenceId: prefix + 'evidence' }],
      createdAt: new Date('2026-10-19T07:08:09.012Z'),
    });
    const finding = await service.createFinding({
      id: prefix + 'finding',
      researchRunId: runId,
      type: 'insight',
      title: 'Recurring manual workflow burden',
      description: 'The finding is supported by a persisted claim and evidence.',
      claimIds: [claim.id],
      createdAt: new Date('2026-10-19T08:09:10.123Z'),
    });

    const trace = await service.traceFinding(finding.id);

    expect(trace.claims[0]?.sourceUrls).toEqual([
      'https://example.test/d1-service-source',
    ]);
  });

  it('rejects missing Evidence without persisting a Claim', async () => {
    await expect(service.createClaim({
      id: prefix + 'missing-evidence-claim',
      researchRunId: runId,
      text: 'Unsupported claim.',
      evidenceRefs: [{ evidenceId: prefix + 'missing' }],
      createdAt: new Date('2026-10-19T07:08:09.012Z'),
    })).rejects.toBeInstanceOf(ReferencedEvidenceNotFoundError);
  });

  it('rejects a cross-run Claim before persisting a Finding', async () => {
    const claim = await service.createClaim({
      id: prefix + 'other-run-claim',
      researchRunId: otherRunId,
      text: 'This claim belongs to another run.',
      evidenceRefs: [{ evidenceId: prefix + 'evidence' }],
      createdAt: new Date('2026-10-19T07:08:09.012Z'),
    });

    await expect(service.createFinding({
      id: prefix + 'cross-run-finding',
      researchRunId: runId,
      type: 'risk',
      title: 'Cross-run reference',
      description: 'This finding must be rejected by the application service.',
      claimIds: [claim.id],
      createdAt: new Date('2026-10-19T08:09:10.123Z'),
    })).rejects.toBeInstanceOf(ClaimResearchRunMismatchError);
  });
});
