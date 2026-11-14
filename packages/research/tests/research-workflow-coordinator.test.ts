import { describe, expect, it, vi } from 'vitest';

import {
  FakeResearchWorkflowHandlers,
  InMemoryResearchWorkflowCoordinator,
  RESEARCH_ANALYSIS_WORKFLOW_DEFINITION,
  ResearchWorkflowHandlerMissingError,
  ResearchWorkflowInvocationConflictError,
} from '../src';

const input = {
  researchRunId: 'run-coordinator-1',
  goal: 'Find a focused product opportunity',
} as const;

describe('InMemoryResearchWorkflowCoordinator', () => {
  it('executes all fake steps in dependency order and returns a completed execution', async () => {
    const fake = new FakeResearchWorkflowHandlers();
    const coordinator = new InMemoryResearchWorkflowCoordinator({ handlers: fake.handlers });

    const execution = await coordinator.run(input);

    expect(execution.status).toBe('completed');
    expect(execution.steps.map((step) => [step.stepId, step.status, step.attempt])).toEqual([
      ['market_understanding', 'completed', 1],
      ['pain_point_research', 'completed', 1],
      ['competitor_research', 'completed', 1],
      ['market_signal_research', 'completed', 1],
      ['opportunity_analysis', 'completed', 1],
      ['report_generation', 'completed', 1],
    ]);
    expect(fake.calls.map((call) => call.definition.id)).toEqual([
      'market_understanding',
      'pain_point_research',
      'competitor_research',
      'market_signal_research',
      'opportunity_analysis',
      'report_generation',
    ]);
    expect(fake.calls[4]?.completedSteps.has('pain_point_research')).toBe(true);
    expect(fake.calls[4]?.completedSteps.has('competitor_research')).toBe(true);
    expect(fake.calls[4]?.completedSteps.has('market_signal_research')).toBe(true);
  });

  it('stops at a typed failed result and marks later steps as skipped', async () => {
    const fake = new FakeResearchWorkflowHandlers({
      results: {
        pain_point_research: {
          status: 'failed',
          stepId: 'pain_point_research',
          failure: {
            kind: 'execution_failed',
            message: 'fake handler failed',
            retryable: true,
          },
        },
      },
    });
    const coordinator = new InMemoryResearchWorkflowCoordinator({ handlers: fake.handlers });

    const execution = await coordinator.run(input);

    expect(execution.status).toBe('failed');
    expect(execution.failure).toEqual({
      kind: 'execution_failed',
      message: 'fake handler failed',
      retryable: true,
    });
    expect(execution.steps.map((step) => [step.stepId, step.status])).toEqual([
      ['market_understanding', 'completed'],
      ['pain_point_research', 'failed'],
      ['competitor_research', 'skipped'],
      ['market_signal_research', 'skipped'],
      ['opportunity_analysis', 'skipped'],
      ['report_generation', 'skipped'],
    ]);
    expect(fake.calls).toHaveLength(2);
  });

  it('converts thrown handler errors into non-retryable execution failures', async () => {
    const fake = new FakeResearchWorkflowHandlers({
      errors: { market_understanding: new Error('handler crashed') },
    });
    const coordinator = new InMemoryResearchWorkflowCoordinator({ handlers: fake.handlers });

    const execution = await coordinator.run(input);

    expect(execution.status).toBe('failed');
    expect(execution.failure).toEqual({
      kind: 'execution_failed',
      message: 'handler crashed',
      retryable: false,
    });
    expect(execution.steps[0]).toMatchObject({
      stepId: 'market_understanding',
      status: 'failed',
      attempt: 1,
    });
  });

  it('rejects a skipped result when the definition disallows skipping', async () => {
    const fake = new FakeResearchWorkflowHandlers({
      results: {
        market_understanding: {
          status: 'skipped',
          stepId: 'market_understanding',
          reason: 'not enough context',
        },
      },
    });
    const coordinator = new InMemoryResearchWorkflowCoordinator({ handlers: fake.handlers });

    const execution = await coordinator.run(input);

    expect(execution.status).toBe('failed');
    expect(execution.failure?.kind).toBe('precondition_failed');
    expect(execution.steps[0]?.status).toBe('failed');
  });

  it('supports an explicitly skippable custom step without adding persistence', async () => {
    const fake = new FakeResearchWorkflowHandlers({
      results: {
        market_understanding: {
          status: 'skipped',
          stepId: 'market_understanding',
          reason: 'optional in this test workflow',
        },
      },
    });
    const coordinator = new InMemoryResearchWorkflowCoordinator({
      handlers: fake.handlers,
      definition: {
        id: 'test-skippable-workflow',
        steps: [{
          id: 'market_understanding',
          dependsOn: [],
          allowSkip: true,
          maxAttempts: 1,
        }],
      },
    });

    const execution = await coordinator.run(input);

    expect(execution.status).toBe('completed');
    expect(execution.steps[0]).toMatchObject({
      status: 'skipped',
      skipReason: 'optional in this test workflow',
    });
  });

  it('cooperatively cancels a running handler and all pending steps', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = new FakeResearchWorkflowHandlers();
    const original = fake.handlers.get('market_understanding');
    const handlers = new Map(fake.handlers);
    handlers.set('market_understanding', async (handlerInput) => {
      await gate;
      if (original === undefined) {
        throw new Error('missing fake handler');
      }
      return original(handlerInput);
    });
    const coordinator = new InMemoryResearchWorkflowCoordinator({ handlers });

    const running = coordinator.run(input);
    await vi.waitFor(() => expect(fake.calls).toHaveLength(0));
    expect(coordinator.cancel(input.researchRunId)).toBe(true);
    release?.();

    const execution = await running;

    expect(execution.status).toBe('cancelled');
    expect(execution.steps.every((step) => step.status === 'cancelled')).toBe(true);
    expect(coordinator.cancel('unknown-run')).toBe(false);
  });

  it('treats an exception caused by active cancellation as cancelled, not failed', async () => {
    let rejectHandler: ((error: Error) => void) | undefined;
    const gate = new Promise<never>((_resolve, reject) => {
      rejectHandler = reject;
    });
    const fake = new FakeResearchWorkflowHandlers();
    const handlers = new Map(fake.handlers);
    handlers.set('market_understanding', async () => gate);
    const coordinator = new InMemoryResearchWorkflowCoordinator({ handlers });

    const running = coordinator.run(input);
    expect(coordinator.cancel(input.researchRunId)).toBe(true);
    rejectHandler?.(new Error('owned reasoner was closed'));

    const execution = await running;
    expect(execution.status).toBe('cancelled');
    expect(execution.failure).toBeUndefined();
    expect(execution.steps.every((step) => step.status === 'cancelled')).toBe(true);
  });

  it('completes the versioned analysis workflow without claiming report generation', async () => {
    const fake = new FakeResearchWorkflowHandlers();
    const coordinator = new InMemoryResearchWorkflowCoordinator({
      definition: RESEARCH_ANALYSIS_WORKFLOW_DEFINITION,
      handlers: fake.handlers,
    });

    const execution = await coordinator.run(input);

    expect(execution.workflowId).toBe('product-scout-analysis-v0.1');
    expect(execution.status).toBe('completed');
    expect(execution.steps.map((step) => step.stepId)).toEqual([
      'market_understanding',
      'pain_point_research',
      'competitor_research',
      'market_signal_research',
      'opportunity_analysis',
    ]);
    expect(fake.calls.some((call) => call.definition.id === 'report_generation')).toBe(false);
  });

  it('reuses the same in-process invocation and rejects a conflicting input', async () => {
    const fake = new FakeResearchWorkflowHandlers();
    const coordinator = new InMemoryResearchWorkflowCoordinator({ handlers: fake.handlers });

    const first = coordinator.run(input);
    const second = coordinator.run(input);
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(fake.calls).toHaveLength(6);

    await expect(coordinator.run({ ...input, goal: 'different goal' }))
      .rejects.toBeInstanceOf(ResearchWorkflowInvocationConflictError);
  });

  it('requires a handler for every step in the selected definition', () => {
    const fake = new FakeResearchWorkflowHandlers();
    const handlers = new Map(fake.handlers);
    handlers.delete('report_generation');

    expect(() => new InMemoryResearchWorkflowCoordinator({ handlers }))
      .toThrow(ResearchWorkflowHandlerMissingError);
  });
});
