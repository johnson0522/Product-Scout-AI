import type {
  ProjectId,
  ResearchStepId,
  ResearchStepStatus,
  ResearchStepType,
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
import { assertResearchTransition, InvalidResearchTransitionError } from './research-state';

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

export interface ResearchStepProgressInput {
  readonly id: ResearchStepId;
  readonly researchRunId: ResearchRunId;
  readonly type: ResearchStepType;
  readonly status: Extract<ResearchStepStatus, 'running' | 'completed' | 'failed' | 'cancelled'>;
  readonly occurredAt: Date;
  readonly errorMessage?: string;
}

/** Business-level step persistence port; it does not store runtime trajectory. */
export interface ResearchStepProgressStore {
  record(input: ResearchStepProgressInput): Promise<void>;
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
  readonly steps: Map<ResearchStepId, ResearchStepProgressInput>;
}

export interface DefaultAgentGatewayOptions {
  readonly eventPublisher?: ResearchEventPublisher;
  readonly eventStore?: ProductEventStore;
  readonly liveEventPublisher?: LiveEventPublisher;
  readonly now?: () => Date;
  readonly stepStore?: ResearchStepProgressStore;
}

export class DefaultAgentGateway implements AgentGateway {
  private readonly startingRuns = new Set<ResearchRunId>();
  private readonly cancellingRuns = new Set<ResearchRunId>();
  private readonly stateWrites = new Map<ResearchRunId, Promise<void>>();
  private readonly activeExecutions = new Map<ResearchRunId, ActiveExecution>();
  private readonly eventPublisher: ResearchEventPublisher;
  private readonly now: () => Date;
  private readonly stepStore: ResearchStepProgressStore | undefined;

  public constructor(
    private readonly runs: ResearchRunStore,
    private readonly runtimeFactory: AgentRuntimeFactory,
    options: DefaultAgentGatewayOptions = {},
  ) {
    this.eventPublisher = options.eventStore === undefined
      ? options.eventPublisher ?? new NoopResearchEventPublisher()
      : new ProductEventStorePublisher(options.eventStore, options.liveEventPublisher);
    this.now = options.now ?? (() => new Date());
    this.stepStore = options.stepStore;
  }

  public async createResearch(input: CreateResearchInput): Promise<ResearchRun> {
    return this.runs.create(input);
  }

  public async startResearch(runId: ResearchRunId): Promise<void> {
    if (this.startingRuns.has(runId)) throw new Error('Research run is already starting');
    this.startingRuns.add(runId);
    try {
      await this.executeResearch(runId);
    } finally {
      this.startingRuns.delete(runId);
    }
  }

  private async executeResearch(runId: ResearchRunId): Promise<void> {
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
      if ((await this.requireRun(runId)).status === 'cancelled') {
        await runtime.cancel(session.id);
        return;
      }

      await this.runs.bindAgentSession(
        runId,
        session.id,
        this.runtimeFactory.metadata,
      );
      await this.transition(runId, run.status, 'running', {
        startedAt: this.now(),
      });
      this.activeExecutions.set(runId, { runtime, sessionId: session.id, steps: new Map() });
      if ((await this.requireRun(runId)).status === 'cancelled') {
        await runtime.cancel(session.id);
        return;
      }

      const deliveredEventIds = new Set<string>();
      let terminalEvent: AgentEvent | undefined;
      const publishRuntimeEvent = async (event: AgentEvent): Promise<void> => {
        if (deliveredEventIds.has(event.eventId)) return;
        if ('researchRunId' in event && event.researchRunId !== runId) {
          throw new Error('Runtime event belongs to a different ResearchRun');
        }
        if (event.type === 'agent.completed' || event.type === 'agent.failed') {
          terminalEvent = event;
          return;
        }
        await this.withStateWrite(runId, async () => {
          if (this.cancellingRuns.has(runId) || deliveredEventIds.has(event.eventId) || (await this.requireRun(runId)).status !== 'running') return;
          await this.recordStepProgress(event);
          await this.eventPublisher.publish(toResearchEvent(runId, event));
          deliveredEventIds.add(event.eventId);
        });
      };
      const result = await runtime.run({
        sessionId: session.id,
        onEvent: publishRuntimeEvent,
      });
      for (const event of result.trajectory.events) {
        await publishRuntimeEvent(event);
      }

      const current = await this.requireRun(runId);
      if (current.status === 'cancelled' || this.cancellingRuns.has(runId)) {
        return;
      }

      if (result.status === 'completed') {
        await this.transition(runId, current.status, 'completed', {
          completedAt: this.now(),
        });
        await this.eventPublisher.publish(toResearchEvent(runId,
          terminalEvent?.type === 'agent.completed' ? terminalEvent : {
            type: 'agent.completed', eventId: `${session.id}:gateway-completed`,
            sessionId: session.id, researchRunId: runId, occurredAt: this.now(),
          }));
        return;
      }

      if (result.status === 'cancelled') {
        await this.transition(runId, current.status, 'cancelled', {
          completedAt: this.now(),
        });
        await this.closeActiveSteps(runId, 'cancelled');
        await this.eventPublisher.publish({
          type: 'research.cancelled', eventId: `${session.id}:gateway-cancelled`,
          researchRunId: runId, occurredAt: this.now(),
        });
        return;
      }

      const message = findRuntimeFailure(result.trajectory.events)
        ?? 'Agent runtime reported a failed run.';
      await this.transition(runId, current.status, 'failed', {
        completedAt: this.now(),
        errorMessage: message,
      });
      await this.closeActiveSteps(runId, 'failed', message);
      await this.eventPublisher.publish(toResearchEvent(runId,
        terminalEvent?.type === 'agent.failed' ? terminalEvent : {
          type: 'agent.failed', eventId: `${session.id}:gateway-failed`,
          sessionId: session.id, researchRunId: runId, occurredAt: this.now(),
          errorMessage: message, recoverable: false,
        }));
    } catch (error: unknown) {
      if (this.cancellingRuns.has(runId)) return;
      if ((await this.runs.findById(runId))?.status === 'cancelled') return;
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
      if (!this.cancellingRuns.has(runId)) this.activeExecutions.delete(runId);
    }
  }

  private async recordStepProgress(event: AgentEvent): Promise<void> {
    if (event.type === 'research.step.started') {
      const progress: ResearchStepProgressInput = {
        id: event.stepId,
        researchRunId: event.researchRunId,
        type: event.stepType,
        status: 'running',
        occurredAt: event.occurredAt,
      };
      await this.stepStore?.record(progress);
      this.activeExecutions.get(event.researchRunId)?.steps.set(event.stepId, progress);
      return;
    }
    if (event.type === 'research.step.completed') {
      await this.stepStore?.record({
        id: event.stepId,
        researchRunId: event.researchRunId,
        type: event.stepType,
        status: event.success ? 'completed' : event.status ?? 'failed',
        occurredAt: event.occurredAt,
        ...(event.errorMessage === undefined ? {} : { errorMessage: event.errorMessage }),
      });
      this.activeExecutions.get(event.researchRunId)?.steps.delete(event.stepId);
    }
  }

  private async closeActiveSteps(
    runId: ResearchRunId,
    status: 'failed' | 'cancelled',
    errorMessage?: string,
  ): Promise<void> {
    const steps = this.activeExecutions.get(runId)?.steps;
    for (const step of steps?.values() ?? []) {
      await this.stepStore?.record({ ...step, status, occurredAt: this.now(), errorMessage });
    }
    steps?.clear();
  }

  public async cancelResearch(runId: ResearchRunId): Promise<void> {
    const run = await this.requireRun(runId);
    assertResearchTransition(run.status, 'cancelled');
    const execution = this.activeExecutions.get(runId);
    if (this.cancellingRuns.has(runId)) throw new Error('Research cancellation is already in progress');
    this.cancellingRuns.add(runId);

    try {
      if (execution !== undefined) {
        await execution.runtime.cancel(execution.sessionId);
      }
      await this.transition(runId, run.status, 'cancelled', {
        completedAt: this.now(),
      });
      await this.closeActiveSteps(runId, 'cancelled');
      await this.eventPublisher.publish({
        type: 'research.cancelled',
        eventId: `gateway-cancel:${runId}:${this.now().toISOString()}`,
        researchRunId: runId,
        occurredAt: this.now(),
      });
    } catch (error: unknown) {
      if (error instanceof InvalidResearchTransitionError) throw error;
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
      this.cancellingRuns.delete(runId);
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
    return this.withStateWrite(runId, async () => {
      // Re-read under the process-local write lock: an earlier await may have
      // allowed cancel or completion to commit since the caller read `from`.
      const current = await this.requireRun(runId);
      assertResearchTransition(current.status, to);
      return this.updateOrThrow(runId, { ...update, status: to });
    });
  }

  private async withStateWrite<T>(runId: ResearchRunId, action: () => Promise<T>): Promise<T> {
    const previous = this.stateWrites.get(runId) ?? Promise.resolve();
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => { release = resolve; });
    this.stateWrites.set(runId, pending);
    await previous;
    try { return await action(); }
    finally {
      release();
      if (this.stateWrites.get(runId) === pending) this.stateWrites.delete(runId);
    }
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
    await this.closeActiveSteps(runId, 'failed', message);
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
