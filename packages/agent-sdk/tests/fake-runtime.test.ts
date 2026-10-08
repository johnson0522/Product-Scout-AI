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
});
