import { randomUUID } from 'node:crypto';

import type {
  AgentEvent,
  AgentRunInput,
  AgentRunResult,
  AgentRuntime,
  AgentSession,
  AgentSessionId,
  AgentTrajectory,
  CreateSessionInput,
} from '@product-scout/agent-sdk';
import type {
  ResearchWorkflowCoordinator,
  ResearchWorkflowExecution,
  ResearchWorkflowStepExecution,
} from '@product-scout/research';

export interface ResearchWorkflowRuntimeOptions {
  readonly coordinator: ResearchWorkflowCoordinator;
  readonly cancelActiveReasoning?: (
    researchRunId: string,
    workflowInvocationKey: string,
  ) => Promise<void>;
  readonly createSessionId?: () => AgentSessionId;
  readonly now?: () => Date;
  readonly workflowTimeoutMs?: number;
}

interface WorkflowSessionState {
  readonly input: CreateSessionInput;
  readonly createdAt: Date;
  readonly events: AgentEvent[];
  status: AgentSession['status'];
}

class ResearchWorkflowTimeoutError extends Error {
  public constructor(public readonly timeoutMs: number) {
    super(`Research workflow timed out after ${timeoutMs}ms`);
    this.name = 'ResearchWorkflowTimeoutError';
  }
}

/** Adapts the application-owned analysis workflow to the existing Gateway runtime contract. */
export class ResearchWorkflowRuntime implements AgentRuntime {
  private readonly sessions = new Map<AgentSessionId, WorkflowSessionState>();
  private readonly createSessionId: () => AgentSessionId;
  private readonly now: () => Date;

  public constructor(private readonly options: ResearchWorkflowRuntimeOptions) {
    this.createSessionId = options.createSessionId
      ?? (() => `analysis-${randomUUID().replaceAll('-', '')}`);
    this.now = options.now ?? (() => new Date());
    if (options.workflowTimeoutMs !== undefined
      && (!Number.isSafeInteger(options.workflowTimeoutMs) || options.workflowTimeoutMs <= 0)) {
      throw new Error('workflowTimeoutMs must be a positive safe integer');
    }
  }

  public async createSession(input: CreateSessionInput): Promise<AgentSession> {
    const id = this.createSessionId();
    if (this.sessions.has(id)) throw new Error(`Duplicate workflow session id: ${id}`);
    const createdAt = this.now();
    this.sessions.set(id, { input, createdAt, events: [], status: 'created' });
    return { id, projectId: input.projectId, researchRunId: input.researchRunId, status: 'created', createdAt };
  }

  public async run(input: AgentRunInput): Promise<AgentRunResult> {
    const state = this.requireSession(input.sessionId);
    if (state.status === 'cancelled') return this.result(input.sessionId, state, 'cancelled');
    if (state.status !== 'created') {
      throw new Error(`Workflow session cannot run from status ${state.status}`);
    }
    state.status = 'running';
    state.events.push({
      type: 'agent.started',
      eventId: `${input.sessionId}:agent.started`,
      sessionId: input.sessionId,
      researchRunId: state.input.researchRunId,
      occurredAt: this.now(),
    });

    try {
      const execution = await this.runWorkflow({
        researchRunId: state.input.researchRunId,
        goal: state.input.goal,
        ...(state.input.constraints === undefined ? {} : { constraints: state.input.constraints }),
        idempotencyKey: input.sessionId,
      });
      state.events.push(...mapWorkflowExecution(input.sessionId, execution, this.now));
      if (execution.status === 'cancelled' || isSessionCancelled(state)) {
        state.status = 'cancelled';
        return this.result(input.sessionId, state, 'cancelled');
      }
      if (execution.status === 'completed') {
        state.status = 'completed';
        state.events.push({
          type: 'agent.completed',
          eventId: `${input.sessionId}:agent.completed`,
          sessionId: input.sessionId,
          researchRunId: state.input.researchRunId,
          occurredAt: execution.completedAt ?? this.now(),
        });
        return this.result(input.sessionId, state, 'completed');
      }
      return this.fail(input.sessionId, state, execution.failure?.message ?? 'Analysis workflow failed.');
    } catch (error: unknown) {
      if (isSessionCancelled(state)) return this.result(input.sessionId, state, 'cancelled');
      return this.fail(input.sessionId, state, errorMessage(error));
    }
  }

  private async runWorkflow(
    input: Parameters<ResearchWorkflowCoordinator['run']>[0],
  ): ReturnType<ResearchWorkflowCoordinator['run']> {
    const execution = this.options.coordinator.run(input);
    const timeoutMs = this.options.workflowTimeoutMs;
    if (timeoutMs === undefined) return execution;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new ResearchWorkflowTimeoutError(timeoutMs));
      }, timeoutMs);
    });
    try {
      return await Promise.race([execution, timeout]);
    } catch (error: unknown) {
      if (error instanceof ResearchWorkflowTimeoutError) {
        this.options.coordinator.cancel(input.researchRunId);
        await this.options.cancelActiveReasoning?.(
          input.researchRunId,
          input.idempotencyKey ?? input.researchRunId,
        );
        void execution.catch(() => undefined);
      }
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  public async resume(sessionId: AgentSessionId): Promise<AgentRunResult> {
    const state = this.requireSession(sessionId);
    if (state.status === 'created') return this.run({ sessionId });
    if (state.status === 'running') {
      throw new Error(`Workflow session is already running: ${sessionId}`);
    }
    return this.result(
      sessionId,
      state,
      state.status,
    );
  }

  public async cancel(sessionId: AgentSessionId): Promise<void> {
    const state = this.requireSession(sessionId);
    if (state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') return;
    state.status = 'cancelled';
    this.options.coordinator.cancel(state.input.researchRunId);
    await this.options.cancelActiveReasoning?.(state.input.researchRunId, sessionId);
  }

  public async getTrajectory(sessionId: AgentSessionId): Promise<AgentTrajectory> {
    return this.trajectory(sessionId, this.requireSession(sessionId));
  }

  private fail(
    sessionId: AgentSessionId,
    state: WorkflowSessionState,
    message: string,
  ): AgentRunResult {
    state.status = 'failed';
    state.events.push({
      type: 'agent.failed',
      eventId: `${sessionId}:agent.failed`,
      sessionId,
      researchRunId: state.input.researchRunId,
      occurredAt: this.now(),
      errorMessage: message,
      recoverable: false,
    });
    return this.result(sessionId, state, 'failed');
  }

  private result(
    sessionId: AgentSessionId,
    state: WorkflowSessionState,
    status: AgentRunResult['status'],
  ): AgentRunResult {
    return { sessionId, status, trajectory: this.trajectory(sessionId, state) };
  }

  private trajectory(sessionId: AgentSessionId, state: WorkflowSessionState): AgentTrajectory {
    return { sessionId, events: [...state.events] };
  }

  private requireSession(sessionId: AgentSessionId): WorkflowSessionState {
    const state = this.sessions.get(sessionId);
    if (state === undefined) throw new Error(`Unknown workflow session: ${sessionId}`);
    return state;
  }
}

function mapWorkflowExecution(
  sessionId: AgentSessionId,
  execution: ResearchWorkflowExecution,
  now: () => Date,
): readonly AgentEvent[] {
  return execution.steps.flatMap((step) => mapStep(sessionId, execution.researchRunId, step, now));
}

function mapStep(
  sessionId: AgentSessionId,
  researchRunId: string,
  step: ResearchWorkflowStepExecution,
  now: () => Date,
): readonly AgentEvent[] {
  if (step.attempt === 0 || step.startedAt === undefined) return [];
  const started: AgentEvent = {
    type: 'research.step.started',
    eventId: `${sessionId}:${step.stepId}:${step.attempt}:started`,
    sessionId,
    researchRunId,
    stepId: `${researchRunId}:${step.stepId}:${step.attempt}`,
    stepType: step.stepId,
    occurredAt: step.startedAt,
  };
  if (step.status === 'running') return [started];
  const completed: AgentEvent = {
    type: 'research.step.completed',
    eventId: `${sessionId}:${step.stepId}:${step.attempt}:completed`,
    sessionId,
    researchRunId,
    stepId: `${researchRunId}:${step.stepId}:${step.attempt}`,
    stepType: step.stepId,
    occurredAt: step.completedAt ?? now(),
    success: step.status === 'completed',
    ...(step.status === 'completed'
      ? {}
      : { errorMessage: step.failure?.message ?? step.skipReason ?? `Step ended as ${step.status}` }),
  };
  const opportunityEvents: AgentEvent[] = step.status === 'completed'
    ? (step.result?.status === 'completed' ? step.result.artifacts ?? [] : [])
      .filter((artifact) => artifact.kind === 'opportunity')
      .map((artifact) => ({
        type: 'opportunity.created',
        eventId: `${sessionId}:${step.stepId}:${artifact.opportunityId}:created`,
        sessionId,
        researchRunId,
        occurredAt: step.completedAt ?? now(),
        opportunityId: artifact.opportunityId,
      }))
    : [];
  return [started, ...opportunityEvents, completed];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSessionCancelled(state: WorkflowSessionState): boolean {
  return state.status === 'cancelled';
}
