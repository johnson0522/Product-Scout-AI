import type {
  ProjectId,
  ResearchConstraints,
  ResearchRun,
  ResearchRunId,
  ResearchRunStatus,
} from '@product-scout/domain';
import type {
  AgentEvent,
  AgentRuntime,
  AgentRuntimeFactory,
  AgentRuntimeMetadata,
  AgentSessionId,
} from '@product-scout/agent-sdk';

import {
  NoopResearchEventPublisher,
  ProductEventStorePublisher,
  type LiveEventPublisher,
  type ProductEventStore,
  type ResearchEvent,
  type ResearchEventPublisher,
  toResearchEvent,
} from './research-events';
import { assertResearchTransition } from './research-state';

export interface CreateResearchInput {
  readonly projectId: ProjectId;
  readonly goal: string;
  readonly constraints?: ResearchConstraints;
}

export interface ResearchRunCreateData extends CreateResearchInput {
  readonly agentSessionId?: AgentSessionId | null;
}

export interface ResearchRunUpdateData {
  readonly status?: ResearchRunStatus;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly errorMessage?: string;
}

/** Persistence port implemented structurally by the database repository. */
export interface ResearchRunStore {
  findById(id: ResearchRunId): Promise<ResearchRun | null>;
  create(input: ResearchRunCreateData): Promise<ResearchRun>;
  update(id: ResearchRunId, input: ResearchRunUpdateData): Promise<ResearchRun | null>;
  bindAgentSession(
    runId: ResearchRunId,
    agentSessionId: AgentSessionId,
    runtimeMetadata: AgentRuntimeMetadata,
  ): Promise<ResearchRun>;
}

export interface AgentGateway {
  createResearch(input: CreateResearchInput): Promise<ResearchRun>;
  startResearch(runId: ResearchRunId): Promise<void>;
  cancelResearch(runId: ResearchRunId): Promise<void>;
}

export class ResearchRunNotFoundError extends Error {
  public constructor(public readonly runId: ResearchRunId) {
    super(`Research run not found: ${runId}`);
    this.name = 'ResearchRunNotFoundError';
  }
}

export class AgentGatewayRuntimeError extends Error {
  public constructor(
    public readonly runId: ResearchRunId,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AgentGatewayRuntimeError';
  }
}

interface ActiveExecution {
  readonly runtime: AgentRuntime;
  readonly sessionId: AgentSessionId;
}

export interface DefaultAgentGatewayOptions {
  readonly eventPublisher?: ResearchEventPublisher;
  readonly eventStore?: ProductEventStore;
  readonly liveEventPublisher?: LiveEventPublisher;
  readonly now?: () => Date;
}

export class DefaultAgentGateway implements AgentGateway {
  private readonly activeExecutions = new Map<ResearchRunId, ActiveExecution>();
  private readonly eventPublisher: ResearchEventPublisher;
  private readonly now: () => Date;

  public constructor(
    private readonly runs: ResearchRunStore,
    private readonly runtimeFactory: AgentRuntimeFactory,
    options: DefaultAgentGatewayOptions = {},
  ) {
    this.eventPublisher = options.eventStore === undefined
      ? options.eventPublisher ?? new NoopResearchEventPublisher()
      : new ProductEventStorePublisher(options.eventStore, options.liveEventPublisher);
    this.now = options.now ?? (() => new Date());
  }

  public async createResearch(input: CreateResearchInput): Promise<ResearchRun> {
    return this.runs.create(input);
  }

  public async startResearch(runId: ResearchRunId): Promise<void> {
    const run = await this.requireRun(runId);
    assertResearchTransition(run.status, 'running');

    try {
      const runtime = await this.runtimeFactory.create();
      const session = await runtime.createSession({
        projectId: run.projectId,
        researchRunId: run.id,
        goal: run.goal,
        ...(run.constraints === undefined ? {} : { constraints: run.constraints }),
      });

      await this.runs.bindAgentSession(
        runId,
        session.id,
        this.runtimeFactory.metadata,
      );
      await this.updateOrThrow(runId, {
        status: 'running',
        startedAt: this.now(),
      });
      this.activeExecutions.set(runId, { runtime, sessionId: session.id });

      const result = await runtime.run({ sessionId: session.id });
      for (const event of result.trajectory.events) {
        await this.eventPublisher.publish(toResearchEvent(runId, event));
      }

      const current = await this.requireRun(runId);
      if (current.status === 'cancelled') {
        return;
      }

      if (result.status === 'completed') {
        await this.transition(runId, current.status, 'completed', {
          completedAt: this.now(),
        });
        return;
      }

      if (result.status === 'cancelled') {
        await this.transition(runId, current.status, 'cancelled', {
          completedAt: this.now(),
        });
        return;
      }

      const message = findRuntimeFailure(result.trajectory.events)
        ?? 'Agent runtime reported a failed run.';
      await this.transition(runId, current.status, 'failed', {
        completedAt: this.now(),
        errorMessage: message,
      });
    } catch (error: unknown) {
      const message = errorMessage(error);
      try {
        await this.recordFailure(runId, message);
      } catch (failureError: unknown) {
        throw new AgentGatewayRuntimeError(
          runId,
          message + '; failure persistence error: ' + errorMessage(failureError),
          { cause: error },
        );
      }
      throw new AgentGatewayRuntimeError(runId, message, {
        cause: error,
      });
    } finally {
      this.activeExecutions.delete(runId);
    }
  }

  public async cancelResearch(runId: ResearchRunId): Promise<void> {
    const run = await this.requireRun(runId);
    assertResearchTransition(run.status, 'cancelled');
    const execution = this.activeExecutions.get(runId);

    try {
      if (execution !== undefined) {
        await execution.runtime.cancel(execution.sessionId);
      }
      await this.transition(runId, run.status, 'cancelled', {
        completedAt: this.now(),
      });
      await this.eventPublisher.publish({
        type: 'research.cancelled',
        eventId: `gateway-cancel:${runId}:${this.now().toISOString()}`,
        researchRunId: runId,
        occurredAt: this.now(),
      });
    } catch (error: unknown) {
      const message = errorMessage(error);
      try {
        await this.recordFailure(runId, message);
      } catch (failureError: unknown) {
        throw new AgentGatewayRuntimeError(
          runId,
          message + '; failure persistence error: ' + errorMessage(failureError),
          { cause: error },
        );
      }
      throw new AgentGatewayRuntimeError(runId, message, {
        cause: error,
      });
    } finally {
      this.activeExecutions.delete(runId);
    }
  }

  private async transition(
    runId: ResearchRunId,
    from: ResearchRunStatus,
    to: ResearchRunStatus,
    update: Omit<ResearchRunUpdateData, 'status'> = {},
  ): Promise<ResearchRun> {
    assertResearchTransition(from, to);
    return this.updateOrThrow(runId, { ...update, status: to });
  }

  private async recordFailure(runId: ResearchRunId, message: string): Promise<void> {
    const run = await this.runs.findById(runId);
    if (run === null || run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      return;
    }

    await this.transition(runId, run.status, 'failed', {
      completedAt: this.now(),
      errorMessage: message,
    });
    const event: ResearchEvent = {
      type: 'research.failed',
      eventId: `gateway-failure:${runId}:${this.now().toISOString()}`,
      researchRunId: runId,
      occurredAt: this.now(),
      errorMessage: message,
      recoverable: false,
    };
    await this.eventPublisher.publish(event);
  }

  private async requireRun(runId: ResearchRunId): Promise<ResearchRun> {
    const run = await this.runs.findById(runId);
    if (run === null) {
      throw new ResearchRunNotFoundError(runId);
    }
    return run;
  }

  private async updateOrThrow(
    runId: ResearchRunId,
    update: ResearchRunUpdateData,
  ): Promise<ResearchRun> {
    const run = await this.runs.update(runId, update);
    if (run === null) {
      throw new ResearchRunNotFoundError(runId);
    }
    return run;
  }
}

function findRuntimeFailure(events: readonly AgentEvent[]): string | undefined {
  const failure = events.find((event) => event.type === 'agent.failed');
  return failure?.errorMessage;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
