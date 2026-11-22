import { FakeResearchQualitySnapshotRepository } from '@product-scout/research';
import { describe, expect, it } from 'vitest';

import { FakeReasoner } from '@product-scout/agent-sdk/testing';
import type {
  Finding,
  FindingId,
  Opportunity,
  ResearchReport,
  ResearchRunId,
  ValidationPlan,
} from '@product-scout/domain';
import {
  createOpportunityAggregateId,
  createSynthesisAggregateId,
} from '@product-scout/research';
import {
  createEvidenceAcquisition,
  type AcquireEvidenceInput,
  type AcquireEvidenceResult,
  type Claim,
  type ClaimId,
  type Evidence,
  type EvidenceAcquisition,
  type EvidenceAcquisitionScope,
  type EvidenceId,
} from '@product-scout/evidence';

import { createResearchWorkflowRuntimeFactory } from '../src/workflow';

describe('createAnalysisWorkflowRuntimeFactory', () => {
  it('executes Search -> Evidence -> Finding -> Opportunity -> Report through injected services', async () => {
    const evidence = new Map<EvidenceId, Evidence>();
    const acquisitions = new InMemoryAcquisitions(evidence);
    const claims = new Map<ClaimId, Claim>();
    const findings = new Map<FindingId, Finding>();
    const reasoner = new FakeReasoner({
      output: {
        claims: [{
          id: 'recurring-work',
          text: 'Teams report recurring reconciliation work.',
          evidenceIds: ['evidence-1', 'evidence-2'],
        }],
        findings: [{
          id: 'workflow-burden',
          type: 'insight',
          title: 'Recurring workflow burden',
          description: 'Independent sources describe recurring work.',
          claimIds: ['recurring-work'],
        }],
        assessments: [
          assessment('evidence-1'),
          assessment('evidence-2'),
        ],
      },
    });
    const opportunityFindingIds: string[] = [];
    const opportunityReasoner = new FakeReasoner({
      output: {
        opportunities: [{
          id: 'reconciliation-assistant',
          findingIds: opportunityFindingIds,
          title: 'Reconciliation assistant',
          targetCustomer: 'Operations teams',
          problem: 'Recurring reconciliation work',
          solution: 'Assisted reconciliation workflow',
          whyNow: 'Operations complexity is increasing',
          monetization: 'Monthly subscription',
          mvp: 'Import, reconcile, and export',
          confidence: 80,
          scoreFactors: scoreFactors(),
        }],
      },
    });
    const opportunities = new Map<string, Opportunity>();
    const reportFindingIds: string[] = [];
    const reportOpportunityIds: string[] = [];
    const reportReasoner = new FakeReasoner({
      output: {
        title: 'Recurring operations work',
        executiveSummary: 'Evidence supports a focused reconciliation opportunity.',
        sections: [{
          id: 'opportunity',
          title: 'Opportunity',
          content: 'A focused assistant could reduce recurring reconciliation work.',
          findingIds: reportFindingIds,
          opportunityIds: reportOpportunityIds,
        }],
        limitations: ['No direct pricing interview was conducted.'],
      },
    });
    const reports = new Map<string, ResearchReport>();
    const validationPlanReasoner = new FakeReasoner({
      output: { days: validationDays() },
    });
    const validationPlans = new Map<string, ValidationPlan>();
    let nextEvidence = 1;
    const factory = createResearchWorkflowRuntimeFactory({
      qualityStore: new FakeResearchQualitySnapshotRepository(),
      reasoner,
      opportunityReasoner,
      reportReasoner,
      validationPlanReasoner,
      search: {
        async execute(input) {
          const number = nextEvidence;
          return {
            query: input.query,
            items: [{
              title: `Source ${number}`,
              url: `https://source-${number}.example/research`,
              snippet: `Independent observation ${number} about recurring work.`,
            }],
          };
        },
      },
      evidenceRepository: {
        async create(item) { evidence.set(item.id, item); },
        async getById(id) { return evidence.get(id) ?? null; },
      },
      evidenceAcquisitionRepository: acquisitions,
      claimRepository: {
        async create(claim) { claims.set(claim.id, claim); },
        async getById(id) { return claims.get(id) ?? null; },
        async listByResearchRunId(runId) {
          return [...claims.values()].filter((claim) => claim.researchRunId === runId);
        },
      },
      findingRepository: {
        async create(finding) { findings.set(finding.id, finding); },
        async getById(id) { return findings.get(id) ?? null; },
        async listByResearchRunId(runId) {
          return [...findings.values()].filter((finding) => finding.researchRunId === runId);
        },
      },
      opportunityStore: {
        async getById(id) { return opportunities.get(id) ?? null; },
        async ensure(opportunity) {
          opportunities.set(opportunity.id, opportunity);
          return opportunity;
        },
      },
      reportStore: {
        async getById(id) { return reports.get(id) ?? null; },
        async ensure(report) {
          reports.set(report.id, report);
          return report;
        },
      },
      validationPlanStore: {
        async getById(id) { return validationPlans.get(id) ?? null; },
        async ensure(plan) {
          validationPlans.set(plan.id, plan);
          return plan;
        },
      },
      evidenceIdGenerator: {
        generate() { return `evidence-${nextEvidence++}`; },
      },
      now: () => new Date('2026-11-14T00:00:00.000Z'),
    });
    const runtime = await factory.create();
    const session = await runtime.createSession({
      projectId: 'project-1',
      researchRunId: 'run-1',
      goal: 'Research recurring operations work',
    });
    opportunityFindingIds.push(createSynthesisAggregateId(
      'run-1',
      session.id,
      'finding',
      'workflow-burden',
    ));
    reportFindingIds.push(...opportunityFindingIds);
    reportOpportunityIds.push(createOpportunityAggregateId(
      'run-1',
      session.id,
      'reconciliation-assistant',
    ));

    const result = await runtime.run({ sessionId: session.id });

    expect(result.status).toBe('completed');
    expect(evidence).toHaveLength(4);
    expect(claims).toHaveLength(1);
    expect(findings).toHaveLength(1);
    expect(opportunities).toHaveLength(1);
    expect(reports).toHaveLength(1);
    expect(validationPlans).toHaveLength(1);
    expect(reasoner.calls.reason).toHaveLength(1);
    expect(opportunityReasoner.calls.reason).toHaveLength(1);
    expect(reportReasoner.calls.reason).toHaveLength(1);
    expect(validationPlanReasoner.calls.reason).toHaveLength(1);
    expect(reasoner.calls.reason[0]?.requestId)
      .toBe(`run-1:${session.id}:synthesis`);
    expect(result.trajectory.events.some((event) =>
      event.type === 'opportunity.created')).toBe(true);
    expect(result.trajectory.events.some((event) =>
      event.type === 'research.step.completed'
      && event.stepType === 'opportunity_analysis'
      && event.success)).toBe(true);
    expect(result.trajectory.events.some((event) =>
      event.type === 'research.step.started'
      && event.stepType === 'report_generation')).toBe(true);
    expect(result.trajectory.events.some((event) =>
      event.type === 'research.step.completed'
      && event.stepType === 'report_generation'
      && event.success)).toBe(true);
  });

  it('maps full-workflow cancellation to all exact reasoning request identities', async () => {
    const reasoner = new FakeReasoner();
    const opportunityReasoner = new FakeReasoner();
    const reportReasoner = new FakeReasoner();
    const validationPlanReasoner = new FakeReasoner();
    const factory = createResearchWorkflowRuntimeFactory({
      qualityStore: new FakeResearchQualitySnapshotRepository(),
      reasoner,
      opportunityReasoner,
      reportReasoner,
      validationPlanReasoner,
      search: { async execute(input) { return { query: input.query, items: [] }; } },
      evidenceRepository: {
        async create() {},
        async getById() { return null; },
      },
      evidenceAcquisitionRepository: new InMemoryAcquisitions(new Map()),
      claimRepository: {
        async create() {},
        async getById() { return null; },
        async listByResearchRunId() { return []; },
      },
      findingRepository: {
        async create() {},
        async getById() { return null; },
        async listByResearchRunId() { return []; },
      },
      opportunityStore: {
        async getById() { return null; },
        async ensure(opportunity) { return opportunity; },
      },
      reportStore: {
        async getById() { return null; },
        async ensure(report) { return report; },
      },
      validationPlanStore: {
        async getById() { return null; },
        async ensure(plan) { return plan; },
      },
    });
    const runtime = await factory.create();
    const session = await runtime.createSession({
      projectId: 'project-1',
      researchRunId: 'run-cancel',
      goal: 'cancel test',
    });

    await runtime.cancel(session.id);

    expect(reasoner.calls.cancel).toEqual([
      `run-cancel:${session.id}:synthesis`,
    ]);
    expect(opportunityReasoner.calls.cancel).toEqual([
      `run-cancel:${session.id}:opportunities`,
    ]);
    expect(reportReasoner.calls.cancel).toEqual([
      `run-cancel:${session.id}:report`,
    ]);
    expect(validationPlanReasoner.calls.cancel).toEqual([
      `run-cancel:${session.id}:validation-plan`,
    ]);
    expect(factory.metadata.workflow).toBe('product-scout-research-v0.1');
  });
});

class InMemoryAcquisitions {
  private readonly values: EvidenceAcquisition[] = [];

  public constructor(private readonly evidence: Map<EvidenceId, Evidence>) {}

  public async acquire(input: AcquireEvidenceInput): Promise<AcquireEvidenceResult> {
    this.evidence.set(input.evidence.id, input.evidence);
    const acquisition = createEvidenceAcquisition({
      id: `acquisition-${this.values.length + 1}`,
      evidenceId: input.evidence.id,
      researchRunId: input.researchRunId,
      workflowInvocationKey: input.workflowInvocationKey,
      stepId: input.stepId,
      sourceFingerprint: input.sourceFingerprint,
      capturedAt: input.capturedAt,
    });
    this.values.push(acquisition);
    return { status: 'created', evidence: input.evidence, acquisition };
  }

  public async getByScope(scope: EvidenceAcquisitionScope): Promise<EvidenceAcquisition | null> {
    return this.values.find((value) =>
      value.researchRunId === scope.researchRunId
      && value.workflowInvocationKey === scope.workflowInvocationKey
      && value.stepId === scope.stepId
      && value.sourceFingerprint === scope.sourceFingerprint) ?? null;
  }

  public async listByResearchRunId(runId: ResearchRunId): Promise<readonly EvidenceAcquisition[]> {
    return this.values.filter((value) => value.researchRunId === runId);
  }

  public async isAssociatedWithResearchRun(
    runId: ResearchRunId,
    evidenceId: EvidenceId,
  ): Promise<boolean> {
    return this.values.some((value) =>
      value.researchRunId === runId && value.evidenceId === evidenceId);
  }
}

function assessment(evidenceId: string) {
  return {
    claimId: 'recurring-work',
    evidenceId,
    relation: 'supports' as const,
    semanticKind: 'user_report' as const,
    sourceKind: 'independent_third_party' as const,
  };
}

function scoreFactors() {
  const factor = (reasoning: string) => ({ value: 75, reasoning });
  return {
    pain: factor('Pain is supported by recurring reports.'),
    willingnessToPay: factor('A focused workflow can save paid labor.'),
    frequency: factor('The work recurs regularly.'),
    market: factor('Operations teams form a broad market.'),
    competition: factor('Existing workflows remain fragmented.'),
    acquisition: factor('Operations communities are reachable.'),
    feasibility: factor('The scoped workflow is technically feasible.'),
  };
}

function validationDays(): ValidationPlan['days'] {
  return [1, 2, 3, 4, 5, 6, 7].map((day) => ({
    day,
    objective: `Validate assumption ${day}`,
    activities: [`Run activity ${day}`],
    successCriteria: [`Meet criterion ${day}`],
  })) as ValidationPlan['days'];
}
