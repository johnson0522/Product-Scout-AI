import { describe, expect, it } from 'vitest';
import type {
  Finding,
  Opportunity,
  ResearchReport,
  ValidationPlan,
} from '@product-scout/domain';

import {
  ResearchWorkflowReportHandler,
  InMemoryResearchWorkflowCoordinator,
  DEFAULT_RESEARCH_WORKFLOW_DEFINITION,
  type ResearchWorkflowStepHandler,
  type ResearchWorkflowStepId,
  type ResearchWorkflowStepHandlerInput,
  type ResearchWorkflowStepResult,
} from '../src';

const finding: Finding = {
  id: 'finding-1',
  researchRunId: 'run-1',
  type: 'insight',
  title: 'Recurring work',
  description: 'Teams report recurring reconciliation work.',
  claimIds: ['claim-1'],
  createdAt: new Date('2026-11-14T00:00:00.000Z'),
};
const opportunity: Opportunity = {
  id: '10000000-0000-5000-8000-000000000001',
  researchRunId: 'run-1',
  title: 'Reconciliation assistant',
  targetCustomer: 'Operations teams',
  problem: 'Recurring reconciliation work',
  evidenceIds: ['evidence-1'],
  solution: 'Assisted reconciliation workflow',
  whyNow: 'Operational complexity is increasing',
  monetization: 'Subscription',
  mvp: 'Import, reconcile, export',
  confidence: 80,
  score: {
    total: 75,
    breakdown: {
      pain: component(80, 0.2),
      willingnessToPay: component(70, 0.2),
      frequency: component(75, 0.15),
      market: component(65, 0.15),
      competition: component(60, 0.1),
      acquisition: component(70, 0.1),
      feasibility: component(85, 0.1),
    },
  },
  scoreReasoning: {
    pain: 'pain',
    willingnessToPay: 'willingness',
    frequency: 'frequency',
    market: 'market',
    competition: 'competition',
    acquisition: 'acquisition',
    feasibility: 'feasibility',
  },
};

describe('ResearchWorkflowReportHandler', () => {
  it('loads approved artifacts, persists the report, and emits a typed artifact', async () => {
    const reports = new Map<string, ResearchReport>();
    const plans = new Map<string, ValidationPlan>();
    const handler = createHandler(reports, plans);

    const result = await handler.handler(input());

    expect(result).toMatchObject({
      status: 'completed',
      stepId: 'report_generation',
      artifacts: expect.arrayContaining([
        expect.objectContaining({
          kind: 'report',
          findingIds: [finding.id],
          opportunityIds: [opportunity.id],
        }),
        expect.objectContaining({ kind: 'validation_plan' }),
      ]),
    });
    expect(reports).toHaveLength(1);
    expect(plans).toHaveLength(1);
  });

  it('blocks missing and quality-rejected Finding inputs', async () => {
    const handler = createHandler(new Map(), new Map());
    const missing = input(new Map());
    await expect(handler.handler(missing)).resolves.toMatchObject({
      status: 'failed',
      failure: { kind: 'precondition_failed' },
    });
    const blocked = input(new Map([['opportunity_analysis', analysisResult('insufficient')]]));
    await expect(handler.handler(blocked)).resolves.toMatchObject({
      status: 'failed',
      failure: { kind: 'precondition_failed' },
    });
  });

  it('does not fabricate a ValidationPlan when analysis produced no Opportunity', async () => {
    const handler = createHandler(new Map(), new Map());
    const result = analysisResult('sufficient');
    const withoutOpportunity: ResearchWorkflowStepResult = {
      ...result,
      artifactIds: [finding.id],
      artifacts: result.status === 'completed'
        ? result.artifacts?.filter((artifact) => artifact.kind !== 'opportunity')
        : [],
    };
    await expect(handler.handler(input(new Map([
      ['opportunity_analysis', withoutOpportunity],
    ])))).resolves.toMatchObject({
      status: 'failed',
      failure: {
        kind: 'precondition_failed',
        message: expect.stringContaining('persisted Opportunity'),
      },
    });
  });

  it('does not call the provider when already cancelled', async () => {
    let called = false;
    const handler = createHandler(new Map(), new Map(), () => { called = true; });
    const cancelled = { ...input(), isCancelled: () => true };
    await expect(handler.handler(cancelled)).resolves.toMatchObject({
      status: 'failed',
      failure: { kind: 'cancelled' },
    });
    expect(called).toBe(false);
  });

  it('reuses the persisted Report when ValidationPlan generation resumes after failure', async () => {
    const reports = new Map<string, ResearchReport>();
    const plans = new Map<string, ValidationPlan>();
    let fail = true;
    let reportCalls = 0;
    const handler = createHandler(reports, plans, () => { reportCalls += 1; }, () => {
      if (fail) return new Error('validation plan provider failed');
      return undefined;
    });

    await expect(handler.handler(input())).rejects.toThrow('validation plan provider failed');
    expect(reports).toHaveLength(1);
    expect(plans).toHaveLength(0);
    fail = false;
    await expect(handler.handler(input())).resolves.toMatchObject({ status: 'completed' });
    expect(reports).toHaveLength(1);
    expect(plans).toHaveLength(1);
    expect(reportCalls).toBe(1);
  });

  it('completes the full six-step workflow when a traceable report is persisted', async () => {
    const report = createHandler(new Map(), new Map());
    const handlers = new Map<ResearchWorkflowStepId, ResearchWorkflowStepHandler>();
    for (const stepId of [
      'market_understanding',
      'pain_point_research',
      'competitor_research',
      'market_signal_research',
    ] as const) {
      handlers.set(stepId, async () => ({ status: 'completed', stepId, artifactIds: [] }));
    }
    handlers.set('opportunity_analysis', async () => analysisResult('sufficient'));
    handlers.set('report_generation', report.handler);
    const coordinator = new InMemoryResearchWorkflowCoordinator({
      definition: DEFAULT_RESEARCH_WORKFLOW_DEFINITION,
      handlers,
    });

    const execution = await coordinator.run({
      researchRunId: 'run-1',
      goal: 'Research recurring work',
      idempotencyKey: 'invocation-1',
    });

    expect(execution.status).toBe('completed');
    expect(execution.steps).toHaveLength(6);
    expect(execution.steps.at(-1)).toMatchObject({
      stepId: 'report_generation',
      status: 'completed',
      result: {
        artifacts: expect.arrayContaining([
          expect.objectContaining({ kind: 'report' }),
          expect.objectContaining({ kind: 'validation_plan' }),
        ]),
      },
    });
  });
});

function createHandler(
  reports: Map<string, ResearchReport>,
  plans: Map<string, ValidationPlan>,
  onPlan?: () => void,
  validationError?: () => Error | undefined,
) {
  return new ResearchWorkflowReportHandler({
    planProvider: {
      async createPlan() {
        onPlan?.();
        return {
          title: 'Recurring work report',
          executiveSummary: 'Evidence supports a focused opportunity.',
          sections: [{
            id: 'opportunity',
            title: 'Opportunity',
            content: 'A focused assistant could reduce recurring work.',
            findingIds: [finding.id],
            opportunityIds: [opportunity.id],
          }],
          limitations: ['No pricing interview was conducted.'],
        };
      },
    },
    reportStore: {
      async getById(id) { return reports.get(id) ?? null; },
      async ensure(report) {
        reports.set(report.id, report);
        return report;
      },
    },
    findingRepository: { async getById(id) { return id === finding.id ? finding : null; } },
    opportunityStore: {
      async getById(id) { return id === opportunity.id ? opportunity : null; },
    },
    validationPlanProvider: {
      async createPlan() {
        const error = validationError?.();
        if (error !== undefined) throw error;
        return { days: validationDays() };
      },
    },
    validationPlanStore: {
      async getById(id) { return plans.get(id) ?? null; },
      async ensure(plan) {
        plans.set(plan.id, plan);
        return plan;
      },
    },
    now: () => new Date('2026-11-14T01:00:00.000Z'),
  });
}

function input(
  completedSteps = new Map([['opportunity_analysis', analysisResult('sufficient')]]),
): ResearchWorkflowStepHandlerInput {
  return {
    workflow: {
      researchRunId: 'run-1',
      goal: 'Research recurring work',
      idempotencyKey: 'invocation-1',
    },
    definition: {
      id: 'report_generation',
      dependsOn: ['opportunity_analysis'],
      allowSkip: false,
      maxAttempts: 1,
    },
    attempt: 1,
    completedSteps,
    isCancelled: () => false,
  };
}

function analysisResult(
  quality: 'sufficient' | 'insufficient',
): ResearchWorkflowStepResult {
  return {
    status: 'completed',
    stepId: 'opportunity_analysis',
    artifactIds: [finding.id, opportunity.id],
    artifacts: [
      { kind: 'finding', findingId: finding.id, claimIds: finding.claimIds },
      {
        kind: 'quality_assessment',
        findingId: finding.id,
        status: quality,
        issueCodes: quality === 'sufficient' ? [] : ['unsupported'],
        requiresHumanReview: quality !== 'sufficient',
      },
      {
        kind: 'opportunity',
        opportunityId: opportunity.id,
        findingIds: [finding.id],
        evidenceIds: opportunity.evidenceIds,
      },
    ],
  };
}

function component(value: number, weight: number) {
  return { value, weight, contribution: value * weight };
}

function validationDays(): ValidationPlan['days'] {
  return [1, 2, 3, 4, 5, 6, 7].map((day) => ({
    day,
    objective: `Validate assumption ${day}`,
    activities: [`Run validation activity ${day}`],
    successCriteria: [`Meet success criterion ${day}`],
  })) as ValidationPlan['days'];
}
