import { describe, expect, it, vi } from 'vitest';
import {
  AgentSessionBindingConflictError,
  type ProductEvent,
  type ResearchRun,
} from '@product-scout/domain';
import {
  FakeRuntimeFactory,
  type FakeRuntimeOptions,
} from '@product-scout/agent-sdk/testing';
import type { AgentEvent } from '@product-scout/agent-sdk';

import {
  DefaultAgentGateway,
  AgentGatewayRuntimeError,
  type CreateResearchInput,
  type ResearchEvent,
  type ResearchEventPublisher,
  type ProductEventStore,
  type ResearchRunStore,
  type ResearchStepProgressInput,
  type ResearchStepProgressStore,
  assertResearchTransition,
  InvalidResearchTransitionError,
} from '../src';

class MemoryRunStore implements ResearchRunStore {
  private sequence = 1;
  private readonly values = new Map<string, ResearchRun>();

  public async findById(id: string): Promise<ResearchRun | null> {
    return this.values.get(id) ?? null;
  }

  public async create(input: CreateResearchInput): Promise<ResearchRun> {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const run: ResearchRun = {
      id: 'run-' + this.sequence++,
      projectId: input.projectId,
      goal: input.goal,
      constraints: input.constraints,
      status: 'pending',
      agentSessionId: null,
      runtimeMetadata: null,
      steps: [],
      createdAt: now,
    };
    this.values.set(run.id, run);
    return run;
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
    const current = this.values.get(id);
    if (current === undefined) return null;
    const updated: ResearchRun = {
      ...current,
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
      ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }),
      ...(input.errorMessage === undefined ? {} : { errorMessage: input.errorMessage }),
    };
    this.values.set(id, updated);
    return updated;
  }

  public async bindAgentSession(
    id: string,
    agentSessionId: string,
    runtimeMetadata: Readonly<Record<string, string>>,
  ): Promise<ResearchRun> {
    const current = this.values.get(id);
    if (current === undefined) throw new Error('Research run not found: ' + id);
    if (current.agentSessionId !== null && current.agentSessionId !== agentSessionId) {
      throw new AgentSessionBindingConflictError(id, current.agentSessionId, agentSessionId);
    }
    const updated = { ...current, agentSessionId, runtimeMetadata };
    this.values.set(id, updated);
    return updated;
  }
}

class CollectingPublisher implements ResearchEventPublisher {
  public readonly events: ResearchEvent[] = [];

  public async publish(event: ResearchEvent): Promise<void> {
    this.events.push(event);
  }
}

class FailingPublisher implements ResearchEventPublisher {
  public async publish(_event: ResearchEvent): Promise<void> {
    throw new Error('event store unavailable');
  }
}

class MemoryProductEventStore implements ProductEventStore {
  public readonly events: ProductEvent[] = [];

  public async append(event: ProductEvent): Promise<void> {
    if (this.events.some((item) => item.researchRunId === event.researchRunId && item.eventId === event.eventId)) {
      return;
    }
    this.events.push(event);
  }

  public async listByResearchRunId(researchRunId: string): Promise<readonly ProductEvent[]> {
    return this.events.filter((event) => event.researchRunId === researchRunId);
  }
}

class MemoryStepStore implements ResearchStepProgressStore {
  public readonly records: ResearchStepProgressInput[] = [];
  public async record(input: ResearchStepProgressInput): Promise<void> {
    this.records.push(input);
  }
}

const baseEvent = {
  eventId: 'event-1',
  sessionId: 'fake-session-1',
  occurredAt: new Date('2026-01-01T00:00:01.000Z'),
} as const;

function successfulEvents(): readonly AgentEvent[] {
  return [
    { ...baseEvent, type: 'agent.started', researchRunId: 'run-1' },
    { ...baseEvent, eventId: 'event-2', type: 'agent.completed', researchRunId: 'run-1' },
  ];
}

function createGateway(options: FakeRuntimeOptions = {}) {
  const runs = new MemoryRunStore();
  const factory = new FakeRuntimeFactory(options);
  const publisher = new CollectingPublisher();
  const gateway = new DefaultAgentGateway(runs, factory, {
    eventPublisher: publisher,
    now: () => new Date('2026-01-01T00:00:02.000Z'),
  });
  return { runs, factory, publisher, gateway };
}

describe('research state transitions', () => {
  it.each([
    ['pending', 'running'],
    ['pending', 'failed'],
    ['pending', 'cancelled'],
    ['running', 'completed'],
    ['running', 'failed'],
    ['running', 'cancelled'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(() => assertResearchTransition(from, to)).not.toThrow();
  });

  it.each([
    ['pending', 'completed'],
    ['running', 'running'],
    ['completed', 'running'],
    ['failed', 'pending'],
    ['cancelled', 'failed'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(() => assertResearchTransition(from, to)).toThrow(
      InvalidResearchTransitionError,
    );
  });
});

describe('DefaultAgentGateway', () => {
  it('does not let cancellation overwrite a completion already committing', async () => {
    const { gateway, runs, publisher } = createGateway({ events: successfulEvents() });
    const run = await gateway.createResearch({ projectId: 'p', goal: 'Race' });
    let release: () => void = () => {};
    const commitGate = new Promise<void>((resolve) => { release = resolve; });
    let committing = false;
    const update = runs.update.bind(runs);
    vi.spyOn(runs, 'update').mockImplementation(async (id, input) => {
      if (input.status === 'completed') { committing = true; await commitGate; }
      return update(id, input);
    });
    const execution = gateway.startResearch(run.id);
    await vi.waitFor(() => expect(committing).toBe(true));
    const cancellation = gateway.cancelResearch(run.id);
    const rejected = expect(cancellation).rejects.toBeInstanceOf(InvalidResearchTransitionError);
    release();
    await execution;
    await rejected;
    expect((await runs.findById(run.id))?.status).toBe('completed');
    expect(publisher.events.filter((event) => event.type === 'research.cancelled')).toHaveLength(0);
  });
  it('commits terminal run status before notifying terminal event subscribers', async () => {
    const runs = new MemoryRunStore();
    const observed: string[] = [];
    const gateway = new DefaultAgentGateway(runs, new FakeRuntimeFactory({ events: successfulEvents() }), {
      eventPublisher: { publish: async (event) => {
        if (event.type === 'research.completed') observed.push((await runs.findById(event.researchRunId))?.status ?? 'missing');
      } },
    });
    const run = await gateway.createResearch({ projectId: 'p', goal: 'ordering' });
    await gateway.startResearch(run.id);
    expect(observed).toEqual(['completed']);
  });

  it('suppresses late completion after a run is cancelled', async () => {
    let release: (() => void) | undefined;
    const runGate = new Promise<void>((resolve) => { release = resolve; });
    const { gateway, factory, publisher } = createGateway({ events: successfulEvents(), runGate });
    const run = await gateway.createResearch({ projectId: 'p', goal: 'cancel' });
    const execution = gateway.startResearch(run.id);
    await vi.waitFor(() => expect(factory.createdRuntimes[0]?.calls.run).toHaveLength(1));
    await gateway.cancelResearch(run.id);
    release?.(); await execution;
    expect(publisher.events.map((event) => event.type)).toEqual(['research.cancelled']);
  });
  it('creates a run with no runtime binding', async () => {
    const { gateway } = createGateway();
    const run = await gateway.createResearch({ projectId: 'project-1', goal: 'Initial state' });

    expect(run.agentSessionId).toBeNull();
  });

  it('binds a session id idempotently and rejects conflicts', async () => {
    const runs = new MemoryRunStore();
    const run = await runs.create({ projectId: 'project-1', goal: 'Binding' });

    await expect(runs.bindAgentSession(run.id, 'session-a', { runtime: 'fake' })).resolves.toMatchObject({
      agentSessionId: 'session-a',
    });
    await expect(runs.bindAgentSession(run.id, 'session-a', { runtime: 'fake' })).resolves.toMatchObject({
      agentSessionId: 'session-a',
    });
    await expect(runs.bindAgentSession(run.id, 'session-b', { runtime: 'fake' })).rejects.toBeInstanceOf(
      AgentSessionBindingConflictError,
    );
  });

  it('creates a run, creates a session, maps events, and completes it', async () => {
    const { gateway, runs, factory, publisher } = createGateway({
      events: successfulEvents(),
    });
    const run = await gateway.createResearch({
      projectId: 'project-1',
      goal: 'Discover a product opportunity',
    });

    await gateway.startResearch(run.id);

    const completed = await runs.findById(run.id);
    expect(completed?.status).toBe('completed');
    expect(factory.createdRuntimes[0]?.calls.createSession[0]?.researchRunId).toBe(run.id);
    expect(factory.createdRuntimes[0]?.calls.run[0]?.sessionId).toBe('fake-session-1');
    expect(publisher.events.map((event) => event.type)).toEqual([
      'research.started',
      'research.completed',
    ]);
  });

  it('publishes runtime events incrementally once and persists step progress', async () => {
    const runs = new MemoryRunStore();
    const stepStore = new MemoryStepStore();
    const publisher = new CollectingPublisher();
    const events: readonly AgentEvent[] = [
      { ...baseEvent, type: 'agent.started', researchRunId: 'run-1' },
      {
        ...baseEvent,
        eventId: 'step-start',
        type: 'research.step.started',
        researchRunId: 'run-1',
        stepId: '10000000-0000-5000-8000-000000000001',
        stepType: 'market_understanding',
      },
      {
        ...baseEvent,
        eventId: 'step-complete',
        type: 'research.step.completed',
        researchRunId: 'run-1',
        stepId: '10000000-0000-5000-8000-000000000001',
        stepType: 'market_understanding',
        success: true,
        status: 'completed',
      },
      { ...baseEvent, eventId: 'event-2', type: 'agent.completed', researchRunId: 'run-1' },
    ];
    const gateway = new DefaultAgentGateway(runs, new FakeRuntimeFactory({ events }), {
      eventPublisher: publisher,
      stepStore,
    });
    const run = await gateway.createResearch({ projectId: 'project-1', goal: 'Progress' });

    await gateway.startResearch(run.id);

    expect(publisher.events.map((event) => event.eventId)).toEqual([
      'event-1', 'step-start', 'step-complete', 'event-2',
    ]);
    expect(stepStore.records.map((record) => record.status)).toEqual(['running', 'completed']);
  });

  it('records a runtime failure and exposes a product failure event', async () => {
    const { gateway, runs, publisher } = createGateway({
      runError: new Error('runtime unavailable'),
    });
    const run = await gateway.createResearch({ projectId: 'project-1', goal: 'Test failure' });

    await expect(gateway.startResearch(run.id)).rejects.toThrow('runtime unavailable');

    const failed = await runs.findById(run.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.errorMessage).toBe('runtime unavailable');
    expect(publisher.events.at(-1)?.type).toBe('research.failed');
  });

  it('fails the execution explicitly when product event persistence fails', async () => {
    const runs = new MemoryRunStore();
    const factory = new FakeRuntimeFactory({ events: successfulEvents() });
    const gateway = new DefaultAgentGateway(runs, factory, {
      eventPublisher: new FailingPublisher(),
    });
    const run = await gateway.createResearch({ projectId: 'project-1', goal: 'Event failure' });

    await expect(gateway.startResearch(run.id)).rejects.toBeInstanceOf(
      AgentGatewayRuntimeError,
    );
    expect((await runs.findById(run.id))?.status).toBe('failed');
  });

  it('cancels a pending run without constructing a runtime session', async () => {
    const { gateway, runs, factory } = createGateway();
    const run = await gateway.createResearch({ projectId: 'project-1', goal: 'Cancel me' });

    await gateway.cancelResearch(run.id);

    expect((await runs.findById(run.id))?.status).toBe('cancelled');
    expect(factory.createdRuntimes).toHaveLength(0);
  });

  it.each(['completed', 'cancelled'] as const)(
    'rejects starting a %s run',
    async (status) => {
      const { gateway, runs, factory } = createGateway({ events: successfulEvents() });
      const run = await gateway.createResearch({ projectId: 'project-1', goal: 'Terminal' });
      if (status === 'completed') {
        await gateway.startResearch(run.id);
      } else {
        await gateway.cancelResearch(run.id);
      }

      await expect(gateway.startResearch(run.id)).rejects.toBeInstanceOf(
        InvalidResearchTransitionError,
      );
      expect(factory.createdRuntimes).toHaveLength(status === 'completed' ? 1 : 0);
      expect((await runs.findById(run.id))?.status).toBe(status);
    },
  );

  it('forwards cancellation to the active runtime', async () => {
    let releaseRun: (() => void) | undefined;
    const runGate = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    const { gateway, runs, factory } = createGateway({
      events: successfulEvents(),
      runGate,
    });
    const run = await gateway.createResearch({ projectId: 'project-1', goal: 'Cancel active' });
    const start = gateway.startResearch(run.id);
    await vi.waitFor(() => {
      expect(factory.createdRuntimes[0]?.calls.run).toHaveLength(1);
    });

    await gateway.cancelResearch(run.id);
    releaseRun?.();
    await start;

    expect(factory.createdRuntimes[0]?.calls.cancel).toEqual(['fake-session-1']);
    expect((await runs.findById(run.id))?.status).toBe('cancelled');
  });

  it('persists product events through the event store in order', async () => {
    const runs = new MemoryRunStore();
    const factory = new FakeRuntimeFactory({ events: successfulEvents() });
    const eventStore = new MemoryProductEventStore();
    const gateway = new DefaultAgentGateway(runs, factory, { eventStore });
    const run = await gateway.createResearch({ projectId: 'project-1', goal: 'Store events' });

    await gateway.startResearch(run.id);

    expect((await eventStore.listByResearchRunId(run.id)).map((event) => event.type)).toEqual([
      'research.started',
      'research.completed',
    ]);
  });

  it('allows a new gateway to recover the persisted binding', async () => {
    const runs = new MemoryRunStore();
    const factory = new FakeRuntimeFactory({ sessionId: 'session-recovered', events: successfulEvents() });
    const firstGateway = new DefaultAgentGateway(runs, factory);
    const run = await firstGateway.createResearch({ projectId: 'project-1', goal: 'Recover binding' });
    await firstGateway.startResearch(run.id);

    const secondGateway = new DefaultAgentGateway(runs, new FakeRuntimeFactory());
    expect(await runs.findById(run.id)).toMatchObject({ agentSessionId: 'session-recovered' });
    await expect(secondGateway.startResearch(run.id)).rejects.toThrow(
      InvalidResearchTransitionError,
    );
  });
});
