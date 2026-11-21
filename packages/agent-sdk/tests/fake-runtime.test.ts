import { describe, expect, it } from 'vitest';
import { FakeRuntimeFactory } from '../src/testing';

describe('FakeRuntimeFactory', () => {
  it('creates isolated deterministic runtime instances', async () => {
    const factory = new FakeRuntimeFactory({ sessionId: 'test-session' });
    const runtime = await factory.create();
    const session = await runtime.createSession({
      projectId: 'project-1',
      researchRunId: 'run-1',
      goal: 'test',
    });

    expect(session.id).toBe('test-session');
    const result = await runtime.run({ sessionId: session.id });
    expect(result.status).toBe('completed');
    expect(factory.createdRuntimes).toEqual([runtime]);
  });

  it('awaits the optional event sink before returning the trajectory', async () => {
    const event = {
      type: 'agent.started' as const,
      eventId: 'event-1',
      sessionId: 'test-session',
      researchRunId: 'run-1',
      occurredAt: new Date('2026-11-16T00:00:00.000Z'),
    };
    const runtime = await new FakeRuntimeFactory({
      sessionId: 'test-session',
      events: [event],
    }).create();
    const session = await runtime.createSession({
      projectId: 'project-1', researchRunId: 'run-1', goal: 'test',
    });
    const delivered: string[] = [];

    const result = await runtime.run({
      sessionId: session.id,
      onEvent: async (value) => { delivered.push(value.eventId); },
    });

    expect(delivered).toEqual(['event-1']);
    expect(result.trajectory.events).toEqual([event]);
  });
});
