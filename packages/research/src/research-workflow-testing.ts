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
