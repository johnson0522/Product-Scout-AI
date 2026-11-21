import type { AgentEvent } from '@product-scout/agent-sdk';

import {
  assertResearchWorkflowStepTransition,
  assertResearchWorkflowTransition,
  getResearchWorkflowExecutionOrder,
  getResearchWorkflowInvocationKey,
  getResearchWorkflowStepReadiness,
  validateResearchWorkflowDefinition,
  validateStartResearchWorkflowInput,
  type ResearchWorkflowDefinition,
  type ResearchWorkflowExecution,
  type ResearchWorkflowFailure,
  type ResearchWorkflowStepDefinition,
  type ResearchWorkflowStepExecution,
  type ResearchWorkflowStepId,
  type ResearchWorkflowStepResult,
  type ResearchWorkflowStatus,
  type StartResearchWorkflowInput,
  DEFAULT_RESEARCH_WORKFLOW_DEFINITION,
} from './research-workflow';

export interface ResearchWorkflowStepHandlerInput {
  readonly workflow: StartResearchWorkflowInput;
  readonly definition: ResearchWorkflowStepDefinition;
  readonly attempt: number;
  readonly completedSteps: ReadonlyMap<ResearchWorkflowStepId, ResearchWorkflowStepResult>;
  readonly isCancelled: () => boolean;
  readonly emit?: (event: AgentEvent) => Promise<void>;
}

export type ResearchWorkflowStepHandler = (
  input: ResearchWorkflowStepHandlerInput,
) => Promise<ResearchWorkflowStepResult>;

export type ResearchWorkflowStepHandlerRegistry = ReadonlyMap<
  ResearchWorkflowStepId,
  ResearchWorkflowStepHandler
>;

export interface ResearchWorkflowCoordinator {
  run(
    input: StartResearchWorkflowInput,
    observer?: ResearchWorkflowObserver,
  ): Promise<ResearchWorkflowExecution>;
  cancel(researchRunId: string): boolean;
}

export interface ResearchWorkflowObserver {
  onStepTransition(execution: ResearchWorkflowStepExecution): Promise<void>;
  onEvent?(event: AgentEvent): Promise<void>;
}

export interface InMemoryResearchWorkflowCoordinatorOptions {
  readonly definition?: ResearchWorkflowDefinition;
  readonly handlers: ResearchWorkflowStepHandlerRegistry;
  readonly now?: () => Date;
}

export class ResearchWorkflowHandlerMissingError extends Error {
  public constructor(public readonly stepId: ResearchWorkflowStepId) {
    super(`No handler registered for workflow step: ${stepId}`);
    this.name = 'ResearchWorkflowHandlerMissingError';
  }
}

export class ResearchWorkflowInvocationConflictError extends Error {
  public constructor(public readonly invocationKey: string) {
    super(`Workflow invocation key is already used with different input: ${invocationKey}`);
    this.name = 'ResearchWorkflowInvocationConflictError';
  }
}

interface Invocation {
  readonly input: StartResearchWorkflowInput;
  readonly promise: Promise<ResearchWorkflowExecution>;
  readonly cancellation: CancellationState;
}

interface CancellationState {
  cancelled: boolean;
}

export class InMemoryResearchWorkflowCoordinator implements ResearchWorkflowCoordinator {
  private readonly definition: ResearchWorkflowDefinition;
  private readonly now: () => Date;
  private readonly invocations = new Map<string, Invocation>();

  public constructor(options: InMemoryResearchWorkflowCoordinatorOptions) {
    this.definition = options.definition ?? DEFAULT_RESEARCH_WORKFLOW_DEFINITION;
    this.now = options.now ?? (() => new Date());
    validateResearchWorkflowDefinition(this.definition);
    this.assertHandlers(options.handlers);
    this.handlers = options.handlers;
  }

  private readonly handlers: ResearchWorkflowStepHandlerRegistry;

  public run(
    input: StartResearchWorkflowInput,
    observer?: ResearchWorkflowObserver,
  ): Promise<ResearchWorkflowExecution> {
    const normalizedInput = validateStartResearchWorkflowInput(input);
    const invocationKey = getResearchWorkflowInvocationKey(normalizedInput);
    const existing = this.invocations.get(invocationKey);
    if (existing !== undefined) {
      if (!sameInput(existing.input, normalizedInput)) {
        return Promise.reject(new ResearchWorkflowInvocationConflictError(invocationKey));
      }
      return existing.promise;
    }

    const cancellation: CancellationState = { cancelled: false };
    const promise = this.execute(normalizedInput, cancellation, observer);
    this.invocations.set(invocationKey, { input: normalizedInput, promise, cancellation });
    return promise;
  }

  public cancel(researchRunId: string): boolean {
    for (const invocation of this.invocations.values()) {
      if (invocation.input.researchRunId === researchRunId) {
        invocation.cancellation.cancelled = true;
        return true;
      }
    }
    return false;
  }

  private async execute(
    input: StartResearchWorkflowInput,
    cancellation: CancellationState,
    observer?: ResearchWorkflowObserver,
  ): Promise<ResearchWorkflowExecution> {
    const startedAt = this.now();
    let workflowStatus: ResearchWorkflowStatus = 'pending';
    assertResearchWorkflowTransition(workflowStatus, 'running');
    workflowStatus = 'running';

    const executions = new Map<ResearchWorkflowStepId, ResearchWorkflowStepExecution>(
      this.definition.steps.map((definition) => [definition.id, {
        stepId: definition.id,
        status: 'pending',
        attempt: 0,
      }]),
    );
    const results = new Map<ResearchWorkflowStepId, ResearchWorkflowStepResult>();
    let workflowFailure: ResearchWorkflowFailure | undefined;

    for (const stepId of getResearchWorkflowExecutionOrder(this.definition)) {
      const definition = this.requireDefinition(stepId);
      const current = this.requireExecution(executions, stepId);

      if (cancellation.cancelled) {
        this.cancelPending(executions);
        workflowStatus = transitionWorkflow(workflowStatus, 'cancelled');
        break;
      }

      const readiness = getResearchWorkflowStepReadiness(
        definition,
        [...executions.values()],
      );
      if (readiness !== 'ready') {
        const failure = readiness === 'dependency_failed'
          ? dependencyFailure(stepId)
          : preconditionFailure(stepId);
        executions.set(stepId, finishStep(current, 'failed', this.now(), failure));
        workflowFailure = failure;
        this.skipPending(executions, `Step ${stepId} could not run because its dependencies were not ready.`);
        workflowStatus = transitionWorkflow(workflowStatus, 'failed');
        break;
      }

      const attempt = current.attempt + 1;
      const running = transitionStep({ ...current, attempt }, 'running', this.now());
      executions.set(stepId, running);
      await observer?.onStepTransition(running);
      const handler = this.handlers.get(stepId);
      if (handler === undefined) {
        throw new ResearchWorkflowHandlerMissingError(stepId);
      }

      let result: ResearchWorkflowStepResult;
      try {
        result = await handler({
          workflow: input,
          definition,
          attempt,
          completedSteps: new Map(results),
          isCancelled: () => cancellation.cancelled,
          ...(observer?.onEvent === undefined ? {} : { emit: observer.onEvent }),
        });
      } catch (error: unknown) {
        if (cancellation.cancelled) {
          const cancelled = transitionStep(running, 'cancelled', this.now());
          executions.set(stepId, cancelled);
          await observer?.onStepTransition(cancelled);
          this.cancelPending(executions);
          workflowStatus = transitionWorkflow(workflowStatus, 'cancelled');
          break;
        }
        const failure = executionFailure(error);
        const failed = finishStep(running, 'failed', this.now(), failure);
        executions.set(stepId, failed);
        await observer?.onStepTransition(failed);
        workflowFailure = failure;
        this.skipPending(executions, `Workflow stopped after step ${stepId} failed.`);
        workflowStatus = transitionWorkflow(workflowStatus, 'failed');
        break;
      }

      if (cancellation.cancelled) {
        const cancelled = transitionStep(running, 'cancelled', this.now());
        executions.set(stepId, cancelled);
        await observer?.onStepTransition(cancelled);
        this.cancelPending(executions);
        workflowStatus = transitionWorkflow(workflowStatus, 'cancelled');
        break;
      }

      if (result.stepId !== stepId) {
        const failure = executionFailure(
          new Error(`Handler returned result for ${result.stepId}, expected ${stepId}`),
        );
        const failed = finishStep(running, 'failed', this.now(), failure);
        executions.set(stepId, failed);
        await observer?.onStepTransition(failed);
        workflowFailure = failure;
        this.skipPending(executions, `Workflow stopped after step ${stepId} returned an invalid result.`);
        workflowStatus = transitionWorkflow(workflowStatus, 'failed');
        break;
      }

      if (result.status === 'completed') {
        const completed = {
          ...transitionStep(running, 'completed', this.now()),
          result,
        } as const;
        executions.set(stepId, completed);
        await observer?.onStepTransition(completed);
        results.set(stepId, result);
        continue;
      }

      if (result.status === 'skipped') {
        if (!definition.allowSkip) {
          const failure = preconditionFailure(
            stepId,
            `Step ${stepId} returned skipped but skipping is not allowed.`,
          );
          const failed = finishStep(running, 'failed', this.now(), failure);
          executions.set(stepId, failed);
          await observer?.onStepTransition(failed);
          workflowFailure = failure;
          this.skipPending(executions, `Workflow stopped after step ${stepId} was not allowed to skip.`);
          workflowStatus = transitionWorkflow(workflowStatus, 'failed');
          break;
        }
        const skipped = {
          ...transitionStep(running, 'skipped', this.now()),
          skipReason: result.reason,
          result,
        } as const;
        executions.set(stepId, skipped);
        await observer?.onStepTransition(skipped);
        results.set(stepId, result);
        continue;
      }

      const failed = {
        ...finishStep(running, 'failed', this.now(), result.failure),
        result,
      } as const;
      executions.set(stepId, failed);
      await observer?.onStepTransition(failed);
      workflowFailure = result.failure;
      this.skipPending(executions, `Workflow stopped after step ${stepId} failed.`);
      workflowStatus = transitionWorkflow(workflowStatus, 'failed');
      break;
    }

    if (workflowStatus === 'running') {
      workflowStatus = transitionWorkflow(workflowStatus, 'completed');
    }

    const completedAt = this.now();
    return {
      workflowId: this.definition.id,
      researchRunId: input.researchRunId,
      status: workflowStatus,
      steps: [...executions.values()],
      startedAt,
      completedAt,
      ...(workflowFailure === undefined ? {} : { failure: workflowFailure }),
    };
  }

  private assertHandlers(handlers: ResearchWorkflowStepHandlerRegistry): void {
    for (const definition of this.definition.steps) {
      if (!handlers.has(definition.id)) {
        throw new ResearchWorkflowHandlerMissingError(definition.id);
      }
    }
  }

  private requireDefinition(stepId: ResearchWorkflowStepId): ResearchWorkflowStepDefinition {
    const definition = this.definition.steps.find((item) => item.id === stepId);
    if (definition === undefined) {
      throw new ResearchWorkflowHandlerMissingError(stepId);
    }
    return definition;
  }

  private requireExecution(
    executions: ReadonlyMap<ResearchWorkflowStepId, ResearchWorkflowStepExecution>,
    stepId: ResearchWorkflowStepId,
  ): ResearchWorkflowStepExecution {
    const execution = executions.get(stepId);
    if (execution === undefined) {
      throw new Error(`Missing workflow step execution: ${stepId}`);
    }
    return execution;
  }

  private skipPending(
    executions: Map<ResearchWorkflowStepId, ResearchWorkflowStepExecution>,
    reason: string,
  ): void {
    for (const [stepId, execution] of executions) {
      if (execution.status === 'pending') {
        executions.set(stepId, {
          ...transitionStep(execution, 'skipped', this.now()),
          skipReason: reason,
        });
      }
    }
  }

  private cancelPending(
    executions: Map<ResearchWorkflowStepId, ResearchWorkflowStepExecution>,
  ): void {
    for (const [stepId, execution] of executions) {
      if (execution.status === 'pending') {
        executions.set(stepId, transitionStep(execution, 'cancelled', this.now()));
      }
    }
  }
}

function transitionWorkflow(
  from: ResearchWorkflowStatus,
  to: ResearchWorkflowStatus,
): ResearchWorkflowStatus {
  assertResearchWorkflowTransition(from, to);
  return to;
}

function transitionStep(
  execution: ResearchWorkflowStepExecution,
  status: ResearchWorkflowStepExecution['status'],
  timestamp: Date,
): ResearchWorkflowStepExecution {
  assertResearchWorkflowStepTransition(execution.status, status);
  return {
    ...execution,
    status,
    ...(status === 'running' ? { startedAt: timestamp } : { completedAt: timestamp }),
  };
}

function finishStep(
  execution: ResearchWorkflowStepExecution,
  status: Extract<ResearchWorkflowStepExecution['status'], 'failed'>,
  timestamp: Date,
  failure: ResearchWorkflowFailure,
): ResearchWorkflowStepExecution {
  return { ...transitionStep(execution, status, timestamp), failure };
}

function executionFailure(error: unknown): ResearchWorkflowFailure {
  return {
    kind: 'execution_failed',
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}

function dependencyFailure(stepId: ResearchWorkflowStepId): ResearchWorkflowFailure {
  return {
    kind: 'dependency_failed',
    message: `Dependencies for step ${stepId} did not complete successfully.`,
    retryable: false,
  };
}

function preconditionFailure(
  stepId: ResearchWorkflowStepId,
  message = `Step ${stepId} was not ready to execute.`,
): ResearchWorkflowFailure {
  return { kind: 'precondition_failed', message, retryable: false };
}

function sameInput(
  left: StartResearchWorkflowInput,
  right: StartResearchWorkflowInput,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
