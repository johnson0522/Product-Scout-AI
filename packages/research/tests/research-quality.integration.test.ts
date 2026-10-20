import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEvidence } from '@product-scout/evidence';
import {
  createDb,
  DrizzleClaimRepository,
  DrizzleEvidenceStoreRepository,
  DrizzleResearchFindingRepository,
  projects,
  researchRuns,
  users,
} from '@product-scout/db';

import {
  ResearchFindingService,
  ResearchQualityAssessmentService,
} from '../src';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const authorized = process.env.PRODUCT_SCOUT_TEST_DATABASE === '1'
  && isDedicatedTestUrl(testDatabaseUrl);
const describeIntegration = authorized ? describe : describe.skip;

if (!authorized) {
  console.warn('BLOCKED: Research Quality integration requires the dedicated test database');
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

describeIntegration('ResearchQualityAssessmentService with PostgreSQL trace', () => {
  const ownerId = randomUUID();
  const projectId = randomUUID();
  const runId = randomUUID();
  const prefix = 'd2-quality-' + Date.now() + '-';
  const findingId = prefix + 'finding';
  let database: ReturnType<typeof createDb>;
  let qualityService: ResearchQualityAssessmentService;

  beforeAll(async () => {
    database = createDb(testDatabaseUrl);
    const evidenceRepository = new DrizzleEvidenceStoreRepository(database.db);
    const findingService = new ResearchFindingService(
      evidenceRepository,
      new DrizzleClaimRepository(database.db),
      new DrizzleResearchFindingRepository(database.db),
    );
    qualityService = new ResearchQualityAssessmentService(findingService);

    await database.db.insert(users).values({
      id: ownerId,
      email: prefix + 'owner@example.test',
      name: 'D2 quality integration owner',
    });
    await database.db.insert(projects).values({
      id: projectId,
      ownerId,
      name: 'D2 quality integration project',
    });
    await database.db.insert(researchRuns).values({
      id: runId,
      projectId,
      goal: 'Assess traceable research quality',
    });

    for (const input of [
      {
        id: prefix + 'evidence-1',
        url: 'https://one.example.test/research',
        excerpt: 'Teams report recurring manual reconciliation work.',
      },
      {
        id: prefix + 'evidence-2',
        url: 'https://two.example.test/research',
        excerpt: 'Independent respondents describe the same recurring workflow.',
      },
    ]) {
      await evidenceRepository.create(createEvidence({
        id: input.id,
        source: { url: input.url },
        title: 'D2 quality evidence',
        excerpt: input.excerpt,
        retrievedAt: new Date('2026-10-19T09:10:11.234Z'),
      }));
    }

    const claim = await findingService.createClaim({
      id: prefix + 'claim',
      researchRunId: runId,
      text: 'Teams report recurring manual reconciliation work.',
      evidenceRefs: [
        { evidenceId: prefix + 'evidence-1' },
        { evidenceId: prefix + 'evidence-2' },
      ],
      createdAt: new Date('2026-10-19T10:11:12.345Z'),
    });
    await findingService.createFinding({
      id: findingId,
      researchRunId: runId,
      type: 'insight',
      title: 'Recurring reconciliation burden',
      description: 'The finding is supported by two traceable research sources.',
      claimIds: [claim.id],
      createdAt: new Date('2026-10-19T11:12:13.456Z'),
    });
  });

  afterAll(async () => {
    await database.client.unsafe(
      'delete from research_finding_claims where finding_id in (select id from research_findings where research_run_id = $1)',
      [runId],
    );
    await database.client.unsafe('delete from research_findings where research_run_id = $1', [runId]);
    await database.client.unsafe(
      'delete from claim_evidence_refs where claim_id in (select id from claims where research_run_id = $1)',
      [runId],
    );
    await database.client.unsafe('delete from claims where research_run_id = $1', [runId]);
    await database.client.unsafe('delete from research_runs where id = $1', [runId]);
    await database.client.unsafe('delete from evidence_store where id like $1', [prefix + '%']);
    await database.client.unsafe('delete from projects where id = $1', [projectId]);
    await database.client.unsafe('delete from users where id = $1', [ownerId]);
    await database.client.end({ timeout: 5 });
  });

  it('loads the persisted D1 trace and returns a sufficient assessment', async () => {
    const result = await qualityService.assessFinding(findingId, [
      relation(prefix + 'evidence-1', 'supports'),
      relation(prefix + 'evidence-2', 'supports'),
    ]);

    expect(result.status).toBe('sufficient');
    expect(result.issues).toEqual([]);
    expect(result.claims[0]?.distinctSupportingSourceUrls).toEqual([
      'https://one.example.test/research',
      'https://two.example.test/research',
    ]);
  });

  it('returns a conflict candidate when caller-provided relations disagree', async () => {
    const result = await qualityService.assessFinding(findingId, [
      relation(prefix + 'evidence-1', 'supports'),
      relation(prefix + 'evidence-2', 'contradicts'),
    ]);

    expect(result.status).toBe('conflicted');
    expect(result.conflictCandidates).toEqual([expect.objectContaining({
      supportingEvidenceIds: [prefix + 'evidence-1'],
      contradictingEvidenceIds: [prefix + 'evidence-2'],
      requiresHumanReview: true,
    })]);
  });

  it('does not persist assessment output or alter D1 aggregates', async () => {
    const before = await qualityService.assessFinding(findingId, []);
    const after = await qualityService.assessFinding(findingId, []);

    expect(after).toEqual(before);
    const assessmentTables = await database.client.unsafe(
      "select to_regclass('public.research_quality_assessments') as name",
    );
    expect(assessmentTables[0]?.name).toBeNull();
  });
});

function relation(
  evidenceId: string,
  relationship: 'supports' | 'contradicts',
) {
  return {
    claimId: prefixClaimId(evidenceId),
    evidenceId,
    relation: relationship,
    semanticKind: 'user_report' as const,
    sourceKind: 'independent_third_party' as const,
  };
}

function prefixClaimId(evidenceId: string): string {
  return evidenceId.replace(/evidence-[12]$/, 'claim');
}
