import { describe, expect, it } from 'vitest';
import type { ResearchRun } from '@product-scout/domain';
import type {
  AgentGateway,
  CreateResearchInput,
} from '@product-scout/research';

import { createResearchPostHandler } from '../app/api/research/handler';

class GatewayStub implements AgentGateway {
  public readonly inputs: CreateResearchInput[] = [];
  public readonly started: string[] = [];

  public async createResearch(input: CreateResearchInput): Promise<ResearchRun> {
    this.inputs.push(input);
    return {
      id: 'run-1',
      projectId: input.projectId,
      goal: input.goal,
      constraints: input.constraints,
      status: 'pending',
      agentSessionId: null,
      runtimeMetadata: null,
      steps: [],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
  }

  public async startResearch(runId: string): Promise<void> {
    this.started.push(runId);
  }

  public async cancelResearch(_runId: string): Promise<void> {}
}

describe('POST /api/research', () => {
  it('creates and starts a research run', async () => {
    const gateway = new GatewayStub();
    const response = await createResearchPostHandler(() => gateway)(
      new Request('http://localhost/api/research', {
        method: 'POST',
        body: JSON.stringify({
          projectId: 'project-1',
          goal: 'Find a product opportunity',
          constraints: { market: 'US' },
        }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ researchRunId: 'run-1' });
    expect(gateway.inputs[0]?.goal).toBe('Find a product opportunity');
    expect(gateway.started).toEqual(['run-1']);
  });

  it('rejects malformed input instead of returning 501', async () => {
    const response = await createResearchPostHandler(() => new GatewayStub())(
      new Request('http://localhost/api/research', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'project-1' }),
      }),
    );

    expect(response.status).toBe(400);
  });
});
