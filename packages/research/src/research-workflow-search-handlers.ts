import type {
  AgentSessionId,
  ToolCompletedEvent,
  ToolStartedEvent,
} from '@product-scout/agent-sdk';
import type { ResearchRunId } from '@product-scout/domain';

import {
  type EvidenceAcquisitionIngestionExecutor,
  type EvidenceIngestionResult,
  type SearchExecutor,
} from './evidence-ingestion';
import type {
  ResearchWorkflowStepHandler,
  ResearchWorkflowStepHandlerInput,
  ResearchWorkflowStepHandlerRegistry,
} from './research-workflow-coordinator';
import type {
  ResearchWorkflowStepDiagnostic,
  ResearchWorkflowStepId,
  ResearchWorkflowStepResult,
} from './research-workflow';
import { getResearchWorkflowGoal, getResearchWorkflowInvocationKey } from './research-workflow';
import type { SearchToolContext, SearchToolInput } from './search';

export interface ResearchWorkflowSearchHandlerOptions {
  readonly search: SearchExecutor;
  readonly ingestion: EvidenceAcquisitionIngestionExecutor;
  readonly sessionId?: AgentSessionId | ((researchRunId: ResearchRunId) => AgentSessionId);
  readonly toolInvocationId?: (stepId: ResearchWorkflowStepId, attempt: number) => string;
  readonly now?: () => Date;
  readonly emit?: (event: ToolStartedEvent | ToolCompletedEvent) => void | Promise<void>;
  readonly limit?: number;
  readonly analysisHandler?: ResearchWorkflowStepHandler;
  readonly reportHandler?: ResearchWorkflowStepHandler;
}

export interface ResearchWorkflowSearchHandlerFactory {
  readonly handlers: ResearchWorkflowStepHandlerRegistry;
  readonly queryForStep: (
    stepId: ResearchWorkflowStepId,
    goal: string,
  ) => string;
}

type SearchableResearchWorkflowStepId = Exclude<
  ResearchWorkflowStepId,
  'opportunity_analysis' | 'report_generation'
>;

const searchableSteps: readonly SearchableResearchWorkflowStepId[] = [
  'market_understanding',
  'pain_point_research',
  'competitor_research',
  'market_signal_research',
];

/**
 * Adapts the existing SearchTool and Evidence ingestion service to workflow
 * handlers. It deliberately does not create Claims, Findings, or Quality
 * Assessment inputs. Evidence and its ResearchRun acquisition are persisted
 * through the injected atomic acquisition boundary.
 */
export class ResearchWorkflowSearchHandlers implements ResearchWorkflowSearchHandlerFactory {
  public readonly handlers: ResearchWorkflowStepHandlerRegistry;
  public readonly queryForStep: (
    stepId: ResearchWorkflowStepId,
    goal: string,
  ) => string;

  public constructor(private readonly options: ResearchWorkflowSearchHandlerOptions) {
    this.queryForStep = defaultQueryForStep;
    const handlers = new Map<ResearchWorkflowStepId, ResearchWorkflowStepHandler>();
    for (const stepId of searchableSteps) {
      handlers.set(stepId, this.createHandler(stepId));
    }
    handlers.set(
      'opportunity_analysis',
      options.analysisHandler ?? this.createUnimplementedHandler('opportunity_analysis'),
    );
    handlers.set(
      'report_generation',
      options.reportHandler ?? this.createUnimplementedHandler('report_generation'),
    );
    this.handlers = handlers;
  }

  private createHandler(stepId: SearchableResearchWorkflowStepId): ResearchWorkflowStepHandler {
    return async (input) => this.executeStep(stepId, input);
  }

  private createUnimplementedHandler(
    stepId: Extract<ResearchWorkflowStepId, 'opportunity_analysis' | 'report_generation'>,
  ): ResearchWorkflowStepHandler {
    return async () => ({
      status: 'failed',
      stepId,
      failure: {
        kind: 'precondition_failed',
        message: `${stepId} is not implemented in the Search/Evidence integration phase.`,
        retryable: false,
      },
    });
  }

  private async executeStep(
    stepId: SearchableResearchWorkflowStepId,
    input: ResearchWorkflowStepHandlerInput,
  ): Promise<ResearchWorkflowStepResult> {
    if (input.isCancelled()) {
      return {
        status: 'failed',
        stepId,
        failure: {
          kind: 'cancelled',
          message: `Workflow was cancelled before ${stepId} started.`,
          retryable: false,
        },
      };
    }

    const sessionId = typeof this.options.sessionId === 'function'
      ? this.options.sessionId(input.workflow.researchRunId)
      : this.options.sessionId ?? `research-run:${input.workflow.researchRunId}`;
    const toolInvocationId = this.options.toolInvocationId?.(stepId, input.attempt)
      ?? `${input.workflow.researchRunId}:${stepId}:${input.attempt}`;
    const searchContext: SearchToolContext = {
      isCancelled: input.isCancelled,
      sessionId,
      researchRunId: input.workflow.researchRunId,
      toolInvocationId,
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
      emit: async (event) => {
        await this.options.emit?.(event);
        await input.emit?.(event);
      },
    };
    const searchInput: SearchToolInput = {
      query: this.queryForStep(stepId, getResearchWorkflowGoal(input.workflow)),
      ...(this.options.limit === undefined ? {} : { limit: this.options.limit }),
    };

    const ingestion = await this.options.ingestion.execute({
      search: this.options.search,
      searchInput,
      searchContext,
      workflowInvocationKey: getResearchWorkflowInvocationKey(input.workflow),
      stepId,
      isCancelled: input.isCancelled,
    });
    for (const item of ingestion.items) {
      if (item.status !== 'persisted' || input.isCancelled()) continue;
      await input.emit?.({
        type: 'evidence.created',
        eventId: `${toolInvocationId}:evidence:${item.evidence.id}`,
        sessionId,
        researchRunId: input.workflow.researchRunId,
        evidenceId: item.evidence.id,
        ...(item.item.sourceId === undefined ? {} : { sourceId: item.item.sourceId }),
        occurredAt: item.evidence.retrievedAt,
      });
    }
    return createResult(stepId, ingestion);
  }
}

function createResult(
  stepId: SearchableResearchWorkflowStepId,
  ingestion: EvidenceIngestionResult,
): ResearchWorkflowStepResult {
  const persistedEvidenceIds = ingestion.items
    .filter((item): item is Extract<typeof item, { status: 'persisted' }> =>
      item.status === 'persisted')
    .map((item) => item.evidence.id);
  const diagnostics = ingestion.items
    .filter((item): item is Exclude<typeof item, { status: 'persisted' }> =>
      item.status !== 'persisted')
    .map((item): ResearchWorkflowStepDiagnostic => ({
      code: `evidence.${item.status}`,
      message: item.errorMessage,
    }));

  if (ingestion.total > 0 && persistedEvidenceIds.length === 0) {
    return {
      status: 'failed',
      stepId,
      failure: {
        kind: 'execution_failed',
        message: `No evidence was persisted for ${stepId}.`,
        retryable: false,
      },
    };
  }

  return {
    status: 'completed',
    stepId,
    artifactIds: persistedEvidenceIds,
    artifacts: persistedEvidenceIds.map((evidenceId) => ({
      kind: 'evidence' as const,
      evidenceId,
      stepId,
    })),
    ...(diagnostics.length === 0 ? {} : { diagnostics }),
  };
}

export function defaultQueryForStep(stepId: ResearchWorkflowStepId, goal: string): string {
  const suffixByStep: Partial<Record<ResearchWorkflowStepId, string>> = {
    market_understanding: '',
    pain_point_research: ' customer pain points complaints',
    competitor_research: ' competitors alternatives',
    market_signal_research: ' market demand trends signals',
  };
  return `${goal.trim()}${suffixByStep[stepId] ?? ''}`.trim();
}

