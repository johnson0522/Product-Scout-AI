import { describe, expect, it } from 'vitest';
import type { ProductEvent, ResearchRun } from '@product-scout/domain';
import type { AgentEvent } from '@product-scout/agent-sdk';
import { FakeRuntimeFactory } from '@product-scout/agent-sdk/testing';
import {
  DefaultAgentGateway,
  type CreateResearchInput,
  type ResearchRunStore,
  type ProductEventStore,
} from '@product-scout/research';

import { createResearchPostHandler } from '../app/api/research/handler';

class MemoryRunStore implements ResearchRunStore {
  private run: ResearchRun | null = null;

  public async findById(id: string): Promise<ResearchRun | null> {
    return this.run?.id === id ? this.run : null;
  }

  public async create(input: CreateResearchInput): Promise<ResearchRun> {
    this.run = {
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
    return this.run;
  }

  public async bindAgentSession(
    id: string,
    agentSessionId: string,
    runtimeMetadata: Readonly<Record<string, string>>,
  ): Promise<ResearchRun> {
    if (this.run?.id !== id) throw new Error('Research run not found: ' + id);
    const updated = { ...this.run, agentSessionId, runtimeMetadata };
    this.run = updated;
    return updated;
  }

  public async update(
    id: string,
    input: {
      readonly status?: ResearchRun['status'];
      readonly startedAt?: Date;
      readonly completedAt?: Date;
      readonly errorMessage?: string;
      readonly agentSessionId?: string;
    },
  ): Promise<ResearchRun | null> {
    if (this.run?.id !== id) return null;
    this.run = {
      ...this.run,
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
      ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }),
      ...(input.errorMessage === undefined ? {} : { errorMessage: input.errorMessage }),
    };
    return this.run;
  }
}

class MemoryProductEventStore implements ProductEventStore {
  public readonly events: ProductEvent[] = [];

  public async append(event: ProductEvent): Promise<void> {
    this.events.push(event);
  }

  public async listByResearchRunId(researchRunId: string): Promise<readonly ProductEvent[]> {
    return this.events.filter((event) => event.researchRunId === researchRunId);
  }
}

const completedEvents: readonly AgentEvent[] = [
  {
    type: 'agent.started',
    eventId: 'event-1',
    sessionId: 'session-1',
    researchRunId: 'run-1',
    occurredAt: new Date('2026-01-01T00:00:01.000Z'),
  },
  {
    type: 'agent.completed',
    eventId: 'event-2',
    sessionId: 'session-1',
    researchRunId: 'run-1',
    occurredAt: new Date('2026-01-01T00:00:02.000Z'),
  },
];

describe('research gateway integration', () => {
  it('runs POST through Gateway and FakeRuntime to a completed ResearchRun', async () => {
    const store = new MemoryRunStore();
    const eventStore = new MemoryProductEventStore();
    const factory = new FakeRuntimeFactory({
      sessionId: 'session-1',
      events: completedEvents,
    });
    const gateway = new DefaultAgentGateway(store, factory, { eventStore });
    const response = await createResearchPostHandler(() => gateway)(
      new Request('http://localhost/api/research', {
        method: 'POST',
        body: JSON.stringify({
          projectId: 'project-1',
          goal: 'Find evidence-backed opportunities',
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect((await store.findById('run-1'))?.status).toBe('completed');
    expect((await eventStore.listByResearchRunId('run-1')).map((event) => event.type)).toEqual([
      'research.started',
      'research.completed',
    ]);
    expect(factory.createdRuntimes[0]?.calls.run).toEqual([
      { sessionId: 'session-1' },
    ]);
  });
});
