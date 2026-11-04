import type {
  ResearchWorkflowStepHandler,
  ResearchWorkflowStepHandlerInput,
  ResearchWorkflowStepHandlerRegistry,
} from './research-workflow-coordinator';
import type {
  ResearchWorkflowStepId,
  ResearchWorkflowStepResult,
} from './research-workflow';

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
