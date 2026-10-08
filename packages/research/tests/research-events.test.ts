import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@product-scout/agent-sdk';

import {
  InMemoryLiveEventPublisher,
  ProductEventStorePublisher,
  toResearchEvent,
  type ProductEventStore,
} from '../src';

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
  { ...base, type: 'tool.started', toolInvocationId: 'tool-1', toolName: 'test_tool' },
  {
    ...base,
    type: 'tool.completed',
    toolInvocationId: 'tool-1',
    toolName: 'test_tool',
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
    errorMessage: 'failed',
    recoverable: false,
  },
];

describe('toResearchEvent', () => {
  it('maps every runtime event to a product-level event', () => {
    expect(events.map((event) => toResearchEvent('run-1', event).type)).toEqual([
      'research.started',
      'research.step.started',
      'research.tool.started',
      'research.tool.completed',
      'research.evidence.created',
      'research.step.completed',
      'research.opportunity.created',
      'research.completed',
      'research.failed',
    ]);
  });
});

describe('InMemoryLiveEventPublisher', () => {
  it('isolates runs, supports multiple subscribers, and cleans up', () => {
    const publisher = new InMemoryLiveEventPublisher();
    const receivedA: string[] = [];
    const receivedB: string[] = [];
    const receivedOther: string[] = [];
    const unsubscribeA = publisher.subscribe('run-a', (event) => {
      receivedA.push(event.eventId);
    });
    publisher.subscribe('run-a', (event) => {
      receivedB.push(event.eventId);
    });
    publisher.subscribe('run-b', (event) => {
      receivedOther.push(event.eventId);
    });

    publisher.publish({ ...events[0]!, type: 'research.started', researchRunId: 'run-a' });
    publisher.publish({ ...events[0]!, type: 'research.started', eventId: 'other', researchRunId: 'run-b' });

    expect(receivedA).toEqual(['event-1']);
    expect(receivedB).toEqual(['event-1']);
    expect(receivedOther).toEqual(['other']);
    expect(publisher.subscriberCount('run-a')).toBe(2);

    unsubscribeA();
    unsubscribeA();
    publisher.publish({ ...events[0]!, type: 'research.started', eventId: 'event-2', researchRunId: 'run-a' });

    expect(receivedA).toEqual(['event-1']);
    expect(receivedB).toEqual(['event-1', 'event-2']);
    expect(publisher.subscriberCount('run-a')).toBe(1);
  });

  it('persists before publishing live notifications', async () => {
    const calls: string[] = [];
    const store: ProductEventStore = {
      append: async () => {
        calls.push('append');
      },
      listByResearchRunId: async () => [],
    };
    const publisher = new InMemoryLiveEventPublisher();
    publisher.subscribe('run-1', () => calls.push('publish'));

    await new ProductEventStorePublisher(store, publisher).publish({
      ...events[0]!,
      type: 'research.started',
      researchRunId: 'run-1',
    });

    expect(calls).toEqual(['append', 'publish']);
  });

  it('does not publish when durable persistence fails', async () => {
    const calls: string[] = [];
    const store: ProductEventStore = {
      append: async () => {
        calls.push('append');
        throw new Error('database unavailable');
      },
      listByResearchRunId: async () => [],
    };
    const publisher = new InMemoryLiveEventPublisher();
    publisher.subscribe('run-1', () => calls.push('publish'));

    await expect(new ProductEventStorePublisher(store, publisher).publish({
      ...events[0]!,
      type: 'research.started',
      researchRunId: 'run-1',
    })).rejects.toThrow('database unavailable');

    expect(calls).toEqual(['append']);
  });
});
