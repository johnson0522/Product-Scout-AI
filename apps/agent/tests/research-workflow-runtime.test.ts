import { describe, expect, it } from 'vitest';

import {
  FakeResearchWorkflowHandlers,
  InMemoryResearchWorkflowCoordinator,
  RESEARCH_ANALYSIS_WORKFLOW_DEFINITION,
} from '@product-scout/research';

import { ResearchWorkflowRuntime } from '../src/runtime/ResearchWorkflowRuntime';
import { ResearchWorkflowRuntimeFactory } from '../src/runtime/ResearchWorkflowRuntimeFactory';

describe('ResearchWorkflowRuntime', () => {
  it('completes the versioned analysis workflow and projects step lifecycle events', async () => {
    const runtime = createRuntime(new FakeResearchWorkflowHandlers({
      results: {
        opportunity_analysis: {
          status: 'completed',
          stepId: 'opportunity_analysis',
          artifactIds: ['opportunity-1'],
          artifacts: [{
            kind: 'opportunity',
            opportunityId: 'opportunity-1',
            findingIds: ['finding-1'],
            evidenceIds: ['evidence-1'],
          }],
        },
      },
    }));
    const session = await runtime.createSession(sessionInput());

    const result = await runtime.run({ sessionId: session.id });

    expect(result.status).toBe('completed');
    expect(result.trajectory.events[0]?.type).toBe('agent.started');
    expect(result.trajectory.events.at(-1)?.type).toBe('agent.completed');
    expect(result.trajectory.events.filter((event) => event.type === 'research.step.started'))
      .toHaveLength(5);
    expect(result.trajectory.events.filter((event) => event.type === 'research.step.completed'))
      .toHaveLength(5);
    expect(result.trajectory.events).toContainEqual(expect.objectContaining({
      type: 'opportunity.created',
      opportunityId: 'opportunity-1',
    }));
    expect(result.trajectory.events.some((event) =>
      event.type === 'research.step.started' && event.stepType === 'report_generation'))
      .toBe(false);
  });

  it('maps workflow failure to an agent failure without claiming completion', async () => {
    const fake = new FakeResearchWorkflowHandlers({
      errors: { opportunity_analysis: new Error('analysis failed') },
    });
    const runtime = createRuntime(fake);
    const session = await runtime.createSession(sessionInput());

    const result = await runtime.run({ sessionId: session.id });

    expect(result.status).toBe('failed');
    expect(result.trajectory.events.at(-1)).toMatchObject({
      type: 'agent.failed',
      errorMessage: 'analysis failed',
    });
    expect(result.trajectory.events.some((event) => event.type === 'agent.completed')).toBe(false);
  });

  it('cancels the coordinator and active reasoner without emitting a late failure', async () => {
    let rejectHandler: ((error: Error) => void) | undefined;
    const gate = new Promise<never>((_resolve, reject) => { rejectHandler = reject; });
    const fake = new FakeResearchWorkflowHandlers();
    const handlers = new Map(fake.handlers);
    handlers.set('market_understanding', async () => gate);
    const coordinator = new InMemoryResearchWorkflowCoordinator({
      definition: RESEARCH_ANALYSIS_WORKFLOW_DEFINITION,
      handlers,
    });
    const cancellations: string[][] = [];
    const runtime = new ResearchWorkflowRuntime({
      coordinator,
      createSessionId: () => 'analysis-session-1',
      cancelActiveReasoning: async (runId, invocationKey) => {
        cancellations.push([runId, invocationKey]);
        rejectHandler?.(new Error('reasoner closed'));
      },
    });
    const session = await runtime.createSession(sessionInput());
    const running = runtime.run({ sessionId: session.id });

    await runtime.cancel(session.id);
    const result = await running;

    expect(result.status).toBe('cancelled');
    expect(cancellations).toEqual([['run-1', 'analysis-session-1']]);
    expect(result.trajectory.events.some((event) => event.type === 'agent.failed')).toBe(false);
  });

  it('fails a bounded workflow on timeout and cancels active work', async () => {
    let rejectHandler: ((error: Error) => void) | undefined;
    const gate = new Promise<never>((_resolve, reject) => { rejectHandler = reject; });
    const fake = new FakeResearchWorkflowHandlers();
    const handlers = new Map(fake.handlers);
    handlers.set('market_understanding', async () => gate);
    const coordinator = new InMemoryResearchWorkflowCoordinator({
      definition: RESEARCH_ANALYSIS_WORKFLOW_DEFINITION,
      handlers,
    });
    const cancellations: string[][] = [];
    const runtime = new ResearchWorkflowRuntime({
      coordinator,
      workflowTimeoutMs: 5,
      createSessionId: () => 'analysis-session-1',
      cancelActiveReasoning: async (runId, invocationKey) => {
        cancellations.push([runId, invocationKey]);
        rejectHandler?.(new Error('reasoner closed after timeout'));
      },
    });
    const session = await runtime.createSession(sessionInput());

    const result = await runtime.run({ sessionId: session.id });

    expect(result.status).toBe('failed');
    expect(result.trajectory.events.at(-1)).toMatchObject({
      type: 'agent.failed',
      errorMessage: 'Research workflow timed out after 5ms',
    });
    expect(cancellations).toEqual([['run-1', 'analysis-session-1']]);
    expect(result.trajectory.events.some((event) => event.type === 'agent.completed')).toBe(false);
  });
});

describe('ResearchWorkflowRuntimeFactory', () => {
  it('creates isolated runtime and coordinator instances', async () => {
    let coordinators = 0;
    const factory = new ResearchWorkflowRuntimeFactory({
      createCoordinator: () => {
        coordinators += 1;
        const fake = new FakeResearchWorkflowHandlers();
        return new InMemoryResearchWorkflowCoordinator({
          definition: RESEARCH_ANALYSIS_WORKFLOW_DEFINITION,
          handlers: fake.handlers,
        });
      },
    });

    expect(await factory.create()).not.toBe(await factory.create());
    expect(coordinators).toBe(2);
    expect(factory.metadata).toMatchObject({ workflow: 'product-scout-analysis-v0.1' });
  });
});

function createRuntime(fake = new FakeResearchWorkflowHandlers()): ResearchWorkflowRuntime {
  return new ResearchWorkflowRuntime({
    coordinator: new InMemoryResearchWorkflowCoordinator({
      definition: RESEARCH_ANALYSIS_WORKFLOW_DEFINITION,
      handlers: fake.handlers,
    }),
    createSessionId: () => 'analysis-session-1',
  });
}

function sessionInput() {
  return {
    projectId: 'project-1',
    researchRunId: 'run-1',
    goal: 'Find a focused product opportunity',
  } as const;
}
