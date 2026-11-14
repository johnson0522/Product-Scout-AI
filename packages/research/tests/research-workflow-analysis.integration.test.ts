import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEvidence } from '@product-scout/evidence';
import {
  createDb,
  DrizzleClaimRepository,
  DrizzleEvidenceAcquisitionRepository,
  DrizzleEvidenceStoreRepository,
  DrizzleResearchFindingRepository,
  projects,
  researchRuns,
  users,
} from '@product-scout/db';

import {
  ResearchFindingService,
  ResearchQualityAssessmentService,
  ResearchWorkflowAnalysisHandler,
  type ResearchWorkflowStepHandlerInput,
  type ResearchWorkflowStepId,
  type ResearchWorkflowStepResult,
} from '../src';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const authorized = process.env.PRODUCT_SCOUT_TEST_DATABASE === '1'
  && isDedicatedTestUrl(testDatabaseUrl);
const describeIntegration = authorized ? describe : describe.skip;

if (!authorized) {
  console.warn('BLOCKED: Workflow synthesis integration requires the dedicated test database');
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

describeIntegration('ResearchWorkflowAnalysisHandler with PostgreSQL repositories', () => {
  const ownerId = randomUUID();
  const projectId = randomUUID();
  const runId = randomUUID();
  const prefix = `d3-e-${Date.now()}-`;
  let database: ReturnType<typeof createDb>;
  let claimRepository: DrizzleClaimRepository;
  let findingRepository: DrizzleResearchFindingRepository;
  let handler: ResearchWorkflowAnalysisHandler;

  beforeAll(async () => {
    database = createDb(testDatabaseUrl);
    const evidenceRepository = new DrizzleEvidenceStoreRepository(database.db);
    const acquisitionRepository = new DrizzleEvidenceAcquisitionRepository(database.db);
    claimRepository = new DrizzleClaimRepository(database.db);
    findingRepository = new DrizzleResearchFindingRepository(database.db);
    const findingService = new ResearchFindingService(
      evidenceRepository,
      acquisitionRepository,
      claimRepository,
      findingRepository,
    );
    handler = new ResearchWorkflowAnalysisHandler({
      planProvider: {
        createPlan: async (input) => ({
          claims: [{
            id: 'recurring-work',
            text: 'Teams report recurring manual reconciliation work.',
            evidenceIds: input.evidence.map((item) => item.evidenceId),
          }],
          findings: [{
            id: 'workflow-burden',
            type: 'insight',
            title: 'Recurring workflow burden',
            description: 'Two persisted sources describe the same recurring burden.',
            claimIds: ['recurring-work'],
          }],
          assessments: input.evidence.map((item) => ({
            claimId: 'recurring-work',
            evidenceId: item.evidenceId,
            relation: 'supports',
            semanticKind: 'user_report',
            sourceKind: 'independent_third_party',
          })),
        }),
      },
      findingService,
      qualityService: new ResearchQualityAssessmentService(findingService),
      opportunityPlanProvider: { createPlan: async () => ({ opportunities: [] }) },
      opportunityStore: {
        async getById() { return null; },
        async ensure(opportunity) { return opportunity; },
      },
      now: () => new Date('2026-11-01T02:00:00.000Z'),
    });

    await database.db.insert(users).values({
      id: ownerId,
      email: `${prefix}owner@example.test`,
      name: 'D3-E integration owner',
    });
    await database.db.insert(projects).values({
      id: projectId,
      ownerId,
      name: 'D3-E integration project',
    });
    await database.db.insert(researchRuns).values({
      id: runId,
      projectId,
      goal: 'Integrate explicit synthesis with quality assessment',
    });

    for (const [index, url] of [
      'https://one.example.test/d3-e',
      'https://two.example.test/d3-e',
    ].entries()) {
      const stored = createEvidence({
        id: `${prefix}evidence-${index + 1}`,
        source: { url },
        title: `D3-E source ${index + 1}`,
        excerpt: 'Teams report recurring manual reconciliation work.',
        retrievedAt: new Date(`2026-11-01T00:00:0${index}.000Z`),
      });
      await acquisitionRepository.acquire({
        evidence: stored,
        researchRunId: runId,
        workflowInvocationKey: `${prefix}invocation`,
        stepId: index === 0 ? 'market_understanding' : 'pain_point_research',
        sourceFingerprint: `sha256:${(index === 0 ? 'a' : 'b').repeat(64)}`,
        capturedAt: stored.retrievedAt,
      });
    }
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
    await database.client.unsafe('delete from evidence_acquisitions where research_run_id = $1', [runId]);
    await database.client.unsafe('delete from research_runs where id = $1', [runId]);
    await database.client.unsafe('delete from evidence_store where id like $1', [`${prefix}%`]);
    await database.client.unsafe('delete from projects where id = $1', [projectId]);
    await database.client.unsafe('delete from users where id = $1', [ownerId]);
    await database.client.end({ timeout: 5 });
  });

  it('persists Claim and Finding, then returns a sufficient Quality artifact', async () => {
    const result = await handler.handler(input());

    expect(result).toMatchObject({
      status: 'completed',
      artifacts: [
        { kind: 'finding' },
        { kind: 'quality_assessment', status: 'sufficient' },
      ],
    });
    expect(await claimRepository.listByResearchRunId(runId)).toHaveLength(1);
    expect(await findingRepository.listByResearchRunId(runId)).toHaveLength(1);
  });

  it('replays the same invocation without duplicate Claim or Finding rows', async () => {
    const replay = await handler.handler(input());

    expect(replay.status).toBe('completed');
    expect(await claimRepository.listByResearchRunId(runId)).toHaveLength(1);
    expect(await findingRepository.listByResearchRunId(runId)).toHaveLength(1);
  });

  function input(): ResearchWorkflowStepHandlerInput {
    const completedSteps = new Map<ResearchWorkflowStepId, ResearchWorkflowStepResult>([
      ['market_understanding', evidenceResult(
        'market_understanding',
        `${prefix}evidence-1`,
      )],
      ['pain_point_research', evidenceResult(
        'pain_point_research',
        `${prefix}evidence-2`,
      )],
    ]);
    return {
      workflow: {
        researchRunId: runId,
        goal: 'Integrate explicit synthesis with quality assessment',
        idempotencyKey: `${prefix}invocation`,
      },
      definition: {
        id: 'opportunity_analysis',
        dependsOn: [
          'pain_point_research',
          'competitor_research',
          'market_signal_research',
        ],
        allowSkip: false,
        maxAttempts: 1,
      },
      attempt: 1,
      completedSteps,
      isCancelled: () => false,
    };
  }
});

function evidenceResult(
  stepId: 'market_understanding' | 'pain_point_research',
  evidenceId: string,
): ResearchWorkflowStepResult {
  return {
    status: 'completed',
    stepId,
    artifactIds: [evidenceId],
    artifacts: [{ kind: 'evidence', evidenceId, stepId }],
  };
}
