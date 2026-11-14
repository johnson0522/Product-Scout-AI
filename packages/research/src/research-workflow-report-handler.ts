import type { Finding, Opportunity } from '@product-scout/domain';
import type { ResearchFindingRepository } from '@product-scout/evidence';

import type { OpportunityStore } from './opportunity-analysis';
import {
  ResearchReportService,
  type ResearchReportPlanProvider,
  type ResearchReportStore,
} from './research-report';
import {
  ValidationPlanService,
  type ValidationPlanProvider,
  type ValidationPlanStore,
} from './validation-plan';
import {
  getResearchWorkflowInvocationKey,
  type ResearchWorkflowArtifact,
  type ResearchWorkflowStepResult,
} from './research-workflow';
import type {
  ResearchWorkflowStepHandler,
  ResearchWorkflowStepHandlerInput,
} from './research-workflow-coordinator';

export interface ResearchWorkflowReportHandlerOptions {
  readonly planProvider: ResearchReportPlanProvider;
  readonly reportStore: ResearchReportStore;
  readonly findingRepository: Pick<ResearchFindingRepository, 'getById'>;
  readonly opportunityStore: Pick<OpportunityStore, 'getById'>;
  readonly validationPlanProvider: ValidationPlanProvider;
  readonly validationPlanStore: ValidationPlanStore;
  readonly now?: () => Date;
}

export class ResearchWorkflowReportHandler {
  public readonly handler: ResearchWorkflowStepHandler;

  public constructor(private readonly options: ResearchWorkflowReportHandlerOptions) {
    this.handler = async (input) => this.execute(input);
  }

  private async execute(
    input: ResearchWorkflowStepHandlerInput,
  ): Promise<ResearchWorkflowStepResult> {
    const stepId = 'report_generation' as const;
    if (input.isCancelled()) return cancelledResult();
    const analysis = input.completedSteps.get('opportunity_analysis');
    if (analysis?.status !== 'completed') {
      return preconditionFailure('Report generation requires completed opportunity analysis.');
    }
    const artifacts = analysis.artifacts ?? [];
    const approvedFindingIds = approvedFindings(artifacts);
    if (approvedFindingIds.length === 0) {
      return preconditionFailure(
        'Report generation requires at least one quality-approved Finding.',
      );
    }
    const opportunityIds = artifacts.flatMap((artifact) =>
      artifact.kind === 'opportunity' ? [artifact.opportunityId] : []);
    if (opportunityIds.length === 0) {
      return preconditionFailure(
        'Validation plan generation requires at least one persisted Opportunity.',
      );
    }
    const findings = await loadFindings(approvedFindingIds, this.options.findingRepository);
    const opportunities = await loadOpportunities(opportunityIds, this.options.opportunityStore);
    if (input.isCancelled()) return cancelledResult();

    const report = await new ResearchReportService(
      this.options.planProvider,
      this.options.reportStore,
      this.options.now ?? (() => new Date()),
    ).generate({
      researchRunId: input.workflow.researchRunId,
      goal: input.workflow.goal,
      invocationKey: getResearchWorkflowInvocationKey(input.workflow),
      findings,
      opportunities,
    });
    if (input.isCancelled()) return cancelledResult();
    const validationPlan = await new ValidationPlanService(
      this.options.validationPlanProvider,
      this.options.validationPlanStore,
      this.options.now ?? (() => new Date()),
    ).generate({
      researchRunId: input.workflow.researchRunId,
      goal: input.workflow.goal,
      invocationKey: getResearchWorkflowInvocationKey(input.workflow),
      report,
      opportunities,
    });
    if (input.isCancelled()) return cancelledResult();
    return {
      status: 'completed',
      stepId,
      artifactIds: [report.id, validationPlan.id],
      artifacts: [
        {
          kind: 'report',
          reportId: report.id,
          findingIds: approvedFindingIds,
          opportunityIds,
        },
        {
          kind: 'validation_plan',
          validationPlanId: validationPlan.id,
          reportId: report.id,
        },
      ],
    };
  }
}

function approvedFindings(artifacts: readonly ResearchWorkflowArtifact[]): readonly string[] {
  const sufficient = new Set(artifacts.flatMap((artifact) =>
    artifact.kind === 'quality_assessment'
      && artifact.status === 'sufficient'
      && !artifact.requiresHumanReview
      ? [artifact.findingId]
      : []));
  return artifacts.flatMap((artifact) =>
    artifact.kind === 'finding' && sufficient.has(artifact.findingId)
      ? [artifact.findingId]
      : []);
}

async function loadFindings(
  ids: readonly string[],
  repository: Pick<ResearchFindingRepository, 'getById'>,
): Promise<readonly Finding[]> {
  const values: Finding[] = [];
  for (const id of ids) {
    const finding = await repository.getById(id);
    if (finding === null) throw new Error(`Report Finding not found: ${id}`);
    values.push(finding);
  }
  return values;
}

async function loadOpportunities(
  ids: readonly string[],
  store: Pick<OpportunityStore, 'getById'>,
): Promise<readonly Opportunity[]> {
  const values: Opportunity[] = [];
  for (const id of ids) {
    const opportunity = await store.getById(id);
    if (opportunity === null) throw new Error(`Report Opportunity not found: ${id}`);
    values.push(opportunity);
  }
  return values;
}

function preconditionFailure(message: string): ResearchWorkflowStepResult {
  return {
    status: 'failed',
    stepId: 'report_generation',
    failure: { kind: 'precondition_failed', message, retryable: false },
  };
}

function cancelledResult(): ResearchWorkflowStepResult {
  return {
    status: 'failed',
    stepId: 'report_generation',
    failure: {
      kind: 'cancelled',
      message: 'Workflow was cancelled before report generation completed.',
      retryable: false,
    },
  };
}
