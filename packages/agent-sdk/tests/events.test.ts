import { describe, expect, it } from 'vitest';

import type { AgentEvent, AgentTrajectory } from '../src';

const base = {
  eventId: 'event-1',
  sessionId: 'session-1',
  occurredAt: new Date('2026-01-01T00:00:00.000Z'),
} as const;

const events: readonly AgentEvent[] = [
  { ...base, type: 'agent.started', researchRunId: 'run-1' },
  {
    ...base,
    type: 'research.step.started',
    researchRunId: 'run-1',
    stepId: 'step-1',
    stepType: 'market_understanding',
  },
  { ...base, type: 'tool.started', toolInvocationId: 'tool-1', toolName: 'web_search' },
  {
    ...base,
    type: 'tool.completed',
    toolInvocationId: 'tool-1',
    toolName: 'web_search',
    success: true,
  },
  {
    ...base,
    type: 'evidence.created',
    researchRunId: 'run-1',
    evidenceId: 'evidence-1',
    sourceId: 'source-1',
  },
  {
    ...base,
    type: 'research.step.completed',
    researchRunId: 'run-1',
    stepId: 'step-1',
    stepType: 'market_understanding',
    success: true,
  },
  {
    ...base,
    type: 'opportunity.created',
    researchRunId: 'run-1',
    opportunityId: 'opportunity-1',
  },
  { ...base, type: 'agent.completed', researchRunId: 'run-1' },
  {
    ...base,
    type: 'agent.failed',
    researchRunId: 'run-1',
    errorMessage: 'runtime unavailable',
    recoverable: false,
  },
];

function describeEvent(event: AgentEvent): string {
  switch (event.type) {
    case 'agent.started':
    case 'agent.completed':
    case 'agent.failed':
      return `agent:${event.researchRunId}`;
    case 'research.step.started':
    case 'research.step.completed':
      return `step:${event.stepType}`;
    case 'tool.started':
    case 'tool.completed':
      return `tool:${event.toolName}`;
    case 'evidence.created':
      return `evidence:${event.evidenceId}`;
    case 'opportunity.created':
      return `opportunity:${event.opportunityId}`;
  }
}

describe('AgentEvent', () => {
  it('represents every supported event variant with a discriminant', () => {
    expect(events.map((event) => event.type)).toEqual([
      'agent.started',
      'research.step.started',
      'tool.started',
      'tool.completed',
      'evidence.created',
      'research.step.completed',
      'opportunity.created',
      'agent.completed',
      'agent.failed',
    ]);
  });

  it('narrows event payloads by type', () => {
    const trajectory: AgentTrajectory = { sessionId: 'session-1', events };

    expect(trajectory.events.map(describeEvent)).toEqual([
      'agent:run-1',
      'step:market_understanding',
      'tool:web_search',
      'tool:web_search',
      'evidence:evidence-1',
      'step:market_understanding',
      'opportunity:opportunity-1',
      'agent:run-1',
      'agent:run-1',
    ]);
  });
});
