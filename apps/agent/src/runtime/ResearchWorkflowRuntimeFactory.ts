import type {
  AgentRuntime,
  AgentRuntimeFactory,
  AgentRuntimeMetadata,
} from '@product-scout/agent-sdk';
import type { ResearchWorkflowCoordinator } from '@product-scout/research';

import { ResearchWorkflowRuntime } from './ResearchWorkflowRuntime';

export interface ResearchWorkflowRuntimeFactoryOptions {
  readonly createCoordinator: () => ResearchWorkflowCoordinator;
  readonly cancelActiveReasoning?: (
    researchRunId: string,
    workflowInvocationKey: string,
  ) => Promise<void>;
  readonly metadata?: AgentRuntimeMetadata;
  readonly workflowTimeoutMs?: number;
}

export class ResearchWorkflowRuntimeFactory implements AgentRuntimeFactory {
  public readonly metadata: AgentRuntimeMetadata;

  public constructor(private readonly options: ResearchWorkflowRuntimeFactoryOptions) {
    this.metadata = options.metadata ?? {
      runtime: 'research-workflow',
      workflow: 'product-scout-analysis-v0.1',
    };
  }

  public async create(): Promise<AgentRuntime> {
    return new ResearchWorkflowRuntime({
      coordinator: this.options.createCoordinator(),
      ...(this.options.workflowTimeoutMs === undefined
        ? {}
        : { workflowTimeoutMs: this.options.workflowTimeoutMs }),
      ...(this.options.cancelActiveReasoning === undefined
        ? {}
        : { cancelActiveReasoning: this.options.cancelActiveReasoning }),
    });
  }
}
