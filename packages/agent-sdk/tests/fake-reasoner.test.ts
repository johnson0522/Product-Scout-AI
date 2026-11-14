import { describe, expect, it } from 'vitest';

import { FakeReasoner } from '../src/testing';

describe('FakeReasoner', () => {
  it('records requests and returns configured structured output', async () => {
    const output = { claims: [], findings: [], assessments: [] } as const;
    const reasoner = new FakeReasoner({ output });

    await expect(reasoner.reason({
      requestId: 'request-1',
      outputContract: 'research-synthesis-plan.v1',
      prompt: 'Synthesize the supplied evidence.',
    })).resolves.toEqual({
      requestId: 'request-1',
      outputContract: 'research-synthesis-plan.v1',
      output,
      events: [],
    });
    expect(reasoner.calls.reason).toHaveLength(1);
  });

  it('propagates configured failures without replacing them', async () => {
    const failure = new Error('reasoning failed');
    const reasoner = new FakeReasoner({ error: failure });

    await expect(reasoner.reason({
      requestId: 'request-2',
      outputContract: 'contract',
      prompt: 'prompt',
    })).rejects.toBe(failure);
  });

  it('records cancellation by request id', async () => {
    const reasoner = new FakeReasoner();

    await reasoner.cancel('request-3');

    expect(reasoner.calls.cancel).toEqual(['request-3']);
  });
});
