import { FakeResearchQualitySnapshotRepository } from '@product-scout/research';
import { describe, expect, it } from 'vitest';
import type { Finding, Opportunity } from '@product-scout/domain';
import {
  createEvidence,
  type AcquireEvidenceInput,
  type AcquireEvidenceResult,
  type Claim,
  type ClaimRepository,
  type Evidence,
  type EvidenceAcquisition,
  type EvidenceAcquisitionRepository,
  type EvidenceAcquisitionScope,
  type EvidenceRepository,
  type ResearchFindingRepository,
} from '@product-scout/evidence';

import {
  InMemoryResearchWorkflowCoordinator,
  ResearchAggregateConflictError,
  ResearchFindingService,
  ResearchQualityAssessmentService,
  ResearchWorkflowAnalysisHandler,
  createSynthesisAggregateId,
  type OpportunityAnalysisPlan,
  type ResearchSynthesisPlan,
  type ResearchWorkflowStepHandler,
  type ResearchWorkflowStepHandlerInput,
  type ResearchWorkflowStepId,
  type ResearchWorkflowStepResult,
} from '../src';

class MemoryEvidenceRepository implements EvidenceRepository {
  public constructor(private readonly values: readonly Evidence[]) {}
  public async create(): Promise<void> { throw new Error('not used'); }
  public async getById(id: string): Promise<Evidence | null> {
    return this.values.find((value) => value.id === id) ?? null;
  }
}

class AssociatedEvidenceRepository implements EvidenceAcquisitionRepository {
  public async acquire(_input: AcquireEvidenceInput): Promise<AcquireEvidenceResult> {
    throw new Error('not used');
  }
  public async getByScope(_scope: EvidenceAcquisitionScope): Promise<EvidenceAcquisition | null> {
    return null;
  }
  public async listByResearchRunId(_researchRunId: string): Promise<readonly EvidenceAcquisition[]> {
    return [];
  }
  public async isAssociatedWithResearchRun(
    researchRunId: string,
    evidenceId: string,
  ): Promise<boolean> {
    return researchRunId === 'run-analysis' && evidenceId.startsWith('evidence-');
  }
}

class MemoryClaimRepository implements ClaimRepository {
  public readonly values: Claim[] = [];
  public async create(claim: Claim): Promise<void> {
    if (this.values.some((value) => value.id === claim.id)) throw new Error('duplicate Claim');
    this.values.push(claim);
  }
  public async getById(id: string): Promise<Claim | null> {
    return this.values.find((value) => value.id === id) ?? null;
  }
  public async listByResearchRunId(researchRunId: string): Promise<readonly Claim[]> {
    return this.values.filter((value) => value.researchRunId === researchRunId);
  }
}

class MemoryFindingRepository implements ResearchFindingRepository {
  public readonly values: Finding[] = [];
  public async create(finding: Finding): Promise<void> {
    if (this.values.some((value) => value.id === finding.id)) throw new Error('duplicate Finding');
    this.values.push(finding);
  }
  public async getById(id: string): Promise<Finding | null> {
    return this.values.find((value) => value.id === id) ?? null;
  }
  public async listByResearchRunId(researchRunId: string): Promise<readonly Finding[]> {
    return this.values.filter((value) => value.researchRunId === researchRunId);
  }
}

class MemoryOpportunityStore {
  public readonly values = new Map<string, Opportunity>();
  public async getById(id: string): Promise<Opportunity | null> {
    return this.values.get(id) ?? null;
  }
  public async ensure(opportunity: Opportunity): Promise<Opportunity> {
    const existing = this.values.get(opportunity.id);
    if (existing !== undefined) {
      if (JSON.stringify(existing) !== JSON.stringify(opportunity)) {
        throw new Error('Opportunity conflict');
      }
      return existing;
    }
    this.values.set(opportunity.id, opportunity);
    return opportunity;
  }
}

const evidence = [
  createEvidence({
    id: 'evidence-1',
    source: { url: 'https://one.example.test/research' },
    title: 'First source',
    excerpt: 'Teams report recurring reconciliation work.',
    retrievedAt: new Date('2026-11-01T00:00:00.000Z'),
  }),
  createEvidence({
    id: 'evidence-2',
    source: { url: 'https://two.example.test/research' },
    title: 'Second source',
    excerpt: 'Independent users describe the same recurring work.',
    retrievedAt: new Date('2026-11-01T00:00:01.000Z'),
  }),
];

const sufficientPlan: ResearchSynthesisPlan = {
  claims: [{
    id: 'recurring-work',
    text: 'Teams report recurring reconciliation work.',
    evidenceIds: evidence.map((item) => item.id),
  }],
  findings: [{
    id: 'workflow-burden',
    type: 'insight',
    title: 'Recurring workflow burden',
    description: 'Independent sources describe a recurring operational burden.',
    claimIds: ['recurring-work'],
  }],
  assessments: evidence.map((item) => ({
    claimId: 'recurring-work',
    evidenceId: item.id,
    relation: 'supports' as const,
    semanticKind: 'user_report' as const,
    sourceKind: 'independent_third_party' as const,
  })),
};

function setup(
  plan: ResearchSynthesisPlan = sufficientPlan,
  opportunityPlan: OpportunityAnalysisPlan = { opportunities: [] },
) {
  const claims = new MemoryClaimRepository();
  const findings = new MemoryFindingRepository();
  const findingService = new ResearchFindingService(
    new MemoryEvidenceRepository(evidence),
    new AssociatedEvidenceRepository(),
    claims,
    findings,
  );
  const providerCalls: unknown[] = [];
  const opportunities = new MemoryOpportunityStore();
  const qualityStore = new FakeResearchQualitySnapshotRepository();
  const analysis = new ResearchWorkflowAnalysisHandler({
    planProvider: {
      createPlan: async (input) => {
        providerCalls.push(input);
        return plan;
      },
    },
    findingService,
    qualityStore,
    qualityService: new ResearchQualityAssessmentService(findingService),
    opportunityPlanProvider: { createPlan: async () => opportunityPlan },
    opportunityStore: opportunities,
    now: () => new Date('2026-11-01T01:00:00.000Z'),
  });
  return { analysis, claims, findings, opportunities, providerCalls, qualityStore };
}

describe('ResearchWorkflowAnalysisHandler', () => {
  it('persists explicit synthesis, assesses quality, and emits typed artifacts', async () => {
    const { analysis, claims, findings, providerCalls, qualityStore } = setup();

    const result = await analysis.handler(handlerInput());

    expect(result).toMatchObject({
      status: 'completed',
      stepId: 'opportunity_analysis',
      artifacts: [
        { kind: 'finding' },
        { kind: 'quality_assessment', status: 'sufficient', issueCodes: [] },
      ],
    });
    expect(claims.values).toHaveLength(1);
    expect(findings.values).toHaveLength(1);
    expect(qualityStore.values).toHaveLength(1);
    expect(qualityStore.values[0]).toMatchObject({
      researchRunId: 'run-analysis', rulesVersion: 'rqc-v1',
      workflowInvocationKey: 'invocation-analysis',
      assessment: { status: 'sufficient', requiresHumanReview: false },
    });
    expect(qualityStore.values[0]?.inputs).toHaveLength(2);
    expect(providerCalls).toEqual([expect.objectContaining({
      researchRunId: 'run-analysis',
      invocationKey: 'invocation-analysis',
      evidence: expect.arrayContaining([
        { evidenceId: 'evidence-1', stepId: 'market_understanding' },
        { evidenceId: 'evidence-2', stepId: 'pain_point_research' },
      ]),
    })]);
  });

  it('reuses persisted aggregates on replay and rejects changed content for the same identity', async () => {
    const first = setup();
    const input = handlerInput();
    await first.analysis.handler(input);
    await first.analysis.handler(input);
    expect(first.claims.values).toHaveLength(1);
    expect(first.findings.values).toHaveLength(1);
    expect(first.qualityStore.values).toHaveLength(1);

    const changed = new ResearchWorkflowAnalysisHandler({
      planProvider: {
        createPlan: async () => ({
          ...sufficientPlan,
          claims: [{ ...sufficientPlan.claims[0]!, text: 'Changed Claim content.' }],
        }),
      },
      findingService: new ResearchFindingService(
        new MemoryEvidenceRepository(evidence),
        new AssociatedEvidenceRepository(),
        first.claims,
        first.findings,
      ),
      qualityStore: new FakeResearchQualitySnapshotRepository(),
      qualityService: new ResearchQualityAssessmentService(new ResearchFindingService(
        new MemoryEvidenceRepository(evidence),
        new AssociatedEvidenceRepository(),
        first.claims,
        first.findings,
      )),
      opportunityPlanProvider: { createPlan: async () => ({ opportunities: [] }) },
      opportunityStore: new MemoryOpportunityStore(),
    });
    await expect(changed.handler(input)).rejects.toBeInstanceOf(ResearchAggregateConflictError);
  });

  it('preserves a created Claim and resumes from it after a later Finding write fails', async () => {
    const state = setup();
    const createFinding = state.findings.create.bind(state.findings);
    let fail = true;
    state.findings.create = async (finding) => {
      if (fail) throw new Error('finding insert failed');
      await createFinding(finding);
    };

    await expect(state.analysis.handler(handlerInput()))
      .rejects.toThrow('finding insert failed');
    expect(state.claims.values).toHaveLength(1);
    expect(state.findings.values).toHaveLength(0);

    fail = false;
    const replay = await state.analysis.handler(handlerInput());
    expect(replay.status).toBe('completed');
    expect(state.claims.values).toHaveLength(1);
    expect(state.findings.values).toHaveLength(1);
  });

  it('completes technically but reports an insufficient quality blocker', async () => {
    const plan = {
      ...sufficientPlan,
      assessments: sufficientPlan.assessments.map((assessment) => ({
        ...assessment,
        relation: 'contradicts' as const,
      })),
    };
    const { analysis, qualityStore } = setup(plan);

    const result = await analysis.handler(handlerInput());

    expect(result).toMatchObject({
      status: 'completed',
      diagnostics: [{ code: 'quality.insufficient' }],
      artifacts: [
        { kind: 'finding' },
        {
          kind: 'quality_assessment',
          status: 'insufficient',
          requiresHumanReview: true,
        },
      ],
    });
    expect(qualityStore.values[0]?.assessment.status).toBe('insufficient');
  });

  it('propagates a failed quality write and permits a replay without duplicate aggregates', async () => {
    const state = setup();
    const ensure = state.qualityStore.ensure.bind(state.qualityStore);
    state.qualityStore.ensure = async () => { throw new Error('quality insert failed'); };
    await expect(state.analysis.handler(handlerInput())).rejects.toThrow('quality insert failed');
    expect(state.qualityStore.values).toHaveLength(0);
    expect(state.opportunities.values.size).toBe(0);
    state.qualityStore.ensure = ensure;
    await expect(state.analysis.handler(handlerInput())).resolves.toMatchObject({ status: 'completed' });
    expect(state.claims.values).toHaveLength(1);
    expect(state.findings.values).toHaveLength(1);
    expect(state.qualityStore.values).toHaveLength(1);
  });

  it('does not persist an Opportunity that references a quality-blocked Finding', async () => {
    const blockedPlan = {
      ...sufficientPlan,
      assessments: sufficientPlan.assessments.map((assessment) => ({
        ...assessment,
        relation: 'contradicts' as const,
      })),
    };
    const persistedFindingId = createSynthesisAggregateId(
      'run-analysis',
      'invocation-analysis',
      'finding',
      'workflow-burden',
    );
    const { analysis, opportunities } = setup(blockedPlan, {
      opportunities: [{
        id: 'unsupported-opportunity',
        findingIds: [persistedFindingId],
        title: 'Unsupported opportunity',
        targetCustomer: 'Unknown',
        problem: 'Unverified problem',
        solution: 'Unverified solution',
        whyNow: 'Unknown',
        monetization: 'Unknown',
        mvp: 'Unknown',
        confidence: 50,
        scoreFactors: {
          pain: scoreFactor('pain'),
          willingnessToPay: scoreFactor('willingnessToPay'),
          frequency: scoreFactor('frequency'),
          market: scoreFactor('market'),
          competition: scoreFactor('competition'),
          acquisition: scoreFactor('acquisition'),
          feasibility: scoreFactor('feasibility'),
        },
      }],
    });

    await expect(analysis.handler(handlerInput())).rejects.toThrow('without sufficient quality');
    expect(opportunities.values).toHaveLength(0);
  });

  it('persists scored Opportunities idempotently and emits typed artifacts', async () => {
    const { analysis, opportunities } = setup(sufficientPlan, {
      opportunities: [{
        id: 'reconciliation-assistant',
        findingIds: [createSynthesisAggregateId(
          'run-analysis',
          'invocation-analysis',
          'finding',
          'workflow-burden',
        )],
        title: 'Reconciliation assistant',
        targetCustomer: 'Operations teams',
        problem: 'Recurring reconciliation work',
        solution: 'Assisted reconciliation workflow',
        whyNow: 'Operational complexity is increasing',
        monetization: 'Monthly subscription',
        mvp: 'Import, reconcile, and export',
        confidence: 80,
        scoreFactors: {
          pain: scoreFactor('pain'),
          willingnessToPay: scoreFactor('willingnessToPay'),
          frequency: scoreFactor('frequency'),
          market: scoreFactor('market'),
          competition: scoreFactor('competition'),
          acquisition: scoreFactor('acquisition'),
          feasibility: scoreFactor('feasibility'),
        },
      }],
    });
    const first = await analysis.handler(handlerInput());
    const replay = await analysis.handler(handlerInput());

    expect(first).toMatchObject({
      status: 'completed',
      artifacts: expect.arrayContaining([expect.objectContaining({ kind: 'opportunity' })]),
    });
    expect(replay.status).toBe('completed');
    expect(opportunities.values).toHaveLength(1);
    expect([...opportunities.values.values()][0]).toMatchObject({
      title: 'Reconciliation assistant',
      score: { total: 75 },
      scoreReasoning: { pain: 'pain evidence' },
    });
  });

  it('requires typed Evidence artifacts and rejects provider references outside them', async () => {
    const { analysis } = setup();
    const withoutTypedArtifacts = handlerInput(new Map([
      ['market_understanding', completed('market_understanding', [])],
    ]));
    expect(await analysis.handler(withoutTypedArtifacts)).toMatchObject({
      status: 'failed',
      failure: { kind: 'precondition_failed' },
    });

    const invalid = setup({
      ...sufficientPlan,
      claims: [{ ...sufficientPlan.claims[0]!, evidenceIds: ['outside-workflow'] }],
    });
    await expect(invalid.analysis.handler(handlerInput()))
      .rejects.toThrow('outside the completed workflow');
  });

  it('integrates with the coordinator while report generation remains explicit', async () => {
    const { analysis } = setup();
    const handlers = new Map<ResearchWorkflowStepId, ResearchWorkflowStepHandler>();
    for (const stepId of [
      'market_understanding',
      'pain_point_research',
      'competitor_research',
      'market_signal_research',
    ] as const) {
      handlers.set(stepId, async () => completed(
        stepId,
        stepId === 'market_understanding'
          ? [{ evidenceId: 'evidence-1', stepId }]
          : stepId === 'pain_point_research'
            ? [{ evidenceId: 'evidence-2', stepId }]
            : [],
      ));
    }
    handlers.set('opportunity_analysis', analysis.handler);
    handlers.set('report_generation', async () => ({
      status: 'failed',
      stepId: 'report_generation',
      failure: {
        kind: 'precondition_failed',
        message: 'Report generation is not implemented.',
        retryable: false,
      },
    }));
    const coordinator = new InMemoryResearchWorkflowCoordinator({ handlers });

    const execution = await coordinator.run({
      researchRunId: 'run-analysis',
      goal: 'Find recurring workflow pain',
      idempotencyKey: 'invocation-analysis',
    });

    expect(execution.status).toBe('failed');
    expect(execution.steps.find((step) => step.stepId === 'opportunity_analysis')?.status)
      .toBe('completed');
    expect(execution.steps.find((step) => step.stepId === 'opportunity_analysis')?.result)
      .toMatchObject({
        status: 'completed',
        artifacts: [
          { kind: 'finding' },
          { kind: 'quality_assessment', status: 'sufficient' },
        ],
      });
    expect(execution.steps.find((step) => step.stepId === 'report_generation')?.status)
      .toBe('failed');
  });
});

function handlerInput(
  completedSteps = new Map<ResearchWorkflowStepId, ResearchWorkflowStepResult>([
    ['market_understanding', completed('market_understanding', [
      { evidenceId: 'evidence-1', stepId: 'market_understanding' },
    ])],
    ['pain_point_research', completed('pain_point_research', [
      { evidenceId: 'evidence-2', stepId: 'pain_point_research' },
    ])],
  ]),
): ResearchWorkflowStepHandlerInput {
  return {
    workflow: {
      researchRunId: 'run-analysis',
      goal: 'Find recurring workflow pain',
      idempotencyKey: 'invocation-analysis',
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

function completed(
  stepId: Exclude<ResearchWorkflowStepId, 'opportunity_analysis' | 'report_generation'>,
  items: readonly {
    readonly evidenceId: string;
    readonly stepId: Exclude<ResearchWorkflowStepId, 'opportunity_analysis' | 'report_generation'>;
  }[],
): ResearchWorkflowStepResult {
  return {
    status: 'completed',
    stepId,
    artifactIds: items.map((item) => item.evidenceId),
    artifacts: items.map((item) => ({ kind: 'evidence', ...item })),
  };
}

function scoreFactor(dimension: string) {
  return { value: 75, reasoning: `${dimension} evidence` };
}
