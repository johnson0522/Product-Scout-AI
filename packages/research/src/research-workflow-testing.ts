import type {
  ResearchWorkflowStepHandler,
  ResearchWorkflowStepHandlerInput,
  ResearchWorkflowStepHandlerRegistry,
} from './research-workflow-coordinator';
import type {
  ResearchWorkflowStepId,
  ResearchWorkflowStepResult,
} from './research-workflow';
import type {
  OpportunityAnalysisPlan,
  OpportunityAnalysisPlanInput,
  OpportunityAnalysisPlanProvider,
} from './opportunity-analysis';
import {
  createResearchQualitySnapshot,
  ResearchQualitySnapshotConflictError,
  type ResearchQualitySnapshot,
  type ResearchQualitySnapshotRepository,
} from '@product-scout/evidence';

/** Explicit test port; production composition always supplies the Drizzle store. */
export class FakeResearchQualitySnapshotRepository implements ResearchQualitySnapshotRepository {
  public readonly values: ResearchQualitySnapshot[] = [];
  public async ensure(input: ResearchQualitySnapshot): Promise<ResearchQualitySnapshot> {
    const snapshot = createResearchQualitySnapshot(input);
    const existing = this.values.find((value) => value.findingId === snapshot.findingId
      && value.workflowInvocationKey === snapshot.workflowInvocationKey && value.rulesVersion === snapshot.rulesVersion);
    if (existing !== undefined) {
      if (JSON.stringify(existing.inputs) !== JSON.stringify(snapshot.inputs)
        || JSON.stringify(existing.assessment) !== JSON.stringify(snapshot.assessment)) throw new ResearchQualitySnapshotConflictError();
      return existing;
    }
    this.values.push(snapshot);
    return snapshot;
  }
  public async listByResearchRunId(id: string): Promise<readonly ResearchQualitySnapshot[]> {
    return this.values.filter((value) => value.researchRunId === id);
  }
}

export interface FakeOpportunityAnalysisPlanProviderOptions {
  readonly plan?: OpportunityAnalysisPlan;
  readonly error?: Error;
}

export class FakeOpportunityAnalysisPlanProvider implements OpportunityAnalysisPlanProvider {
  public readonly calls: OpportunityAnalysisPlanInput[] = [];

  public constructor(private readonly options: FakeOpportunityAnalysisPlanProviderOptions = {}) {}

  public async createPlan(input: OpportunityAnalysisPlanInput): Promise<OpportunityAnalysisPlan> {
    this.calls.push(input);
    if (this.options.error !== undefined) throw this.options.error;
    return this.options.plan ?? { opportunities: [] };
  }
}

export interface FakeResearchWorkflowHandlerOptions {
  readonly results?: Readonly<Partial<Record<ResearchWorkflowStepId, ResearchWorkflowStepResult>>>;
  readonly errors?: Readonly<Partial<Record<ResearchWorkflowStepId, Error>>>;
}

export class FakeResearchWorkflowHandlers {
  public readonly calls: ResearchWorkflowStepHandlerInput[] = [];
  public readonly handlers: ResearchWorkflowStepHandlerRegistry;

  public constructor(options: FakeResearchWorkflowHandlerOptions = {}) {
    const handlers = new Map<ResearchWorkflowStepId, ResearchWorkflowStepHandler>();
    const stepIds: readonly ResearchWorkflowStepId[] = [
      'market_understanding',
      'pain_point_research',
      'competitor_research',
      'market_signal_research',
      'opportunity_analysis',
      'report_generation',
    ];
    for (const stepId of stepIds) {
      handlers.set(stepId, async (input) => {
        this.calls.push(input);
        const error = options.errors?.[stepId];
        if (error !== undefined) throw error;
        return options.results?.[stepId] ?? {
          status: 'completed',
          stepId,
          artifactIds: [`fake-artifact:${stepId}`],
        };
      });
    }
    this.handlers = handlers;
  }
}
