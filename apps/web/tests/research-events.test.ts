import { describe, expect, it } from 'vitest';
import type { ProductEvent, ResearchRunStatus } from '@product-scout/domain';
import {
  InMemoryLiveEventPublisher,
  ProductEventStorePublisher,
  type ProductEventStore,
  type StoredProductEvent,
} from '@product-scout/research';

import { createResearchEventsGetHandler } from '../lib/research-events';

type SimpleEventType =
  | 'research.started'
  | 'research.completed'
  | 'research.cancelled'
  | 'research.failed';

class MemoryEventStore implements ProductEventStore {
  public readonly events: StoredProductEvent[] = [];
  public blockFirstRead: Promise<void> | undefined;
  private reads = 0;

  public async append(event: ProductEvent): Promise<void> {
    if (this.events.some((item) => item.eventId === event.eventId)) {
      return;
    }
    this.events.push({ ...event, sequenceNumber: this.events.length + 1 });
  }

  public async listByResearchRunId(
    researchRunId: string,
    afterSequenceNumber = 0,
  ): Promise<readonly StoredProductEvent[]> {
    this.reads += 1;
    if (this.reads === 1 && this.blockFirstRead !== undefined) {
      await this.blockFirstRead;
    }
    return this.events.filter((event) =>
      event.researchRunId === researchRunId
      && (event.sequenceNumber ?? 0) > afterSequenceNumber,
    );
  }
}

function createEvent(
  researchRunId: string,
  eventId: string,
  type: SimpleEventType,
): ProductEvent {
  const base = {
    eventId,
    researchRunId,
    occurredAt: new Date('2026-01-01T00:00:00.000Z'),
  } as const;
  switch (type) {
    case 'research.started':
      return { ...base, type };
    case 'research.completed':
      return { ...base, type };
    case 'research.cancelled':
      return { ...base, type };
    case 'research.failed':
      return { ...base, type, errorMessage: 'failed', recoverable: false };
  }
}

function createHarness(status: ResearchRunStatus = 'running') {
  const eventStore = new MemoryEventStore();
  const liveEventPublisher = new InMemoryLiveEventPublisher();
  const handler = createResearchEventsGetHandler(() => ({
    runs: { findById: async () => ({ status }) },
    eventStore,
    liveEventPublisher,
    heartbeatIntervalMs: 60_000,
  }));
  return { eventStore, liveEventPublisher, handler };
}

async function readAll(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return '';
  }
  const decoder = new TextDecoder();
  let output = '';
  for (;;) {
    const result = await reader.read();
    if (result.done) {
      return output;
    }
    output += decoder.decode(result.value, { stream: true });
  }
}

async function readNext(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const result = await reader.read();
  if (result.done) {
    return '';
  }
  return new TextDecoder().decode(result.value);
}

describe('GET /api/research/:id/events', () => {
  it('returns SSE headers and replays terminal events', async () => {
    const harness = createHarness('completed');
    await new ProductEventStorePublisher(harness.eventStore).publish(createEvent('run-1', 'event-1', 'research.started'));
    await new ProductEventStorePublisher(harness.eventStore).publish(createEvent('run-1', 'event-2', 'research.completed'));

    const response = await harness.handler(
      new Request('http://localhost/api/research/run-1/events'),
      { params: { id: 'run-1' } },
    );
    const body = await readAll(response);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toContain('no-cache');
    expect(body).toContain('id: 1\nevent: research.started');
    expect(body).toContain('id: 2\nevent: research.completed');
  });

  it('replays only events after Last-Event-ID', async () => {
    const harness = createHarness('completed');
    for (const [index, type] of (['research.started', 'research.started', 'research.completed'] as const).entries()) {
      await new ProductEventStorePublisher(harness.eventStore).publish(
        createEvent('run-1', `event-${index + 1}`, type),
      );
    }

    const response = await harness.handler(
      new Request('http://localhost/api/research/run-1/events', {
        headers: { 'Last-Event-ID': '2' },
      }),
      { params: { id: 'run-1' } },
    );
    const body = await readAll(response);

    expect(body).not.toContain('id: 1');
    expect(body).not.toContain('id: 2');
    expect(body).toContain('id: 3');
  });

  it('delivers live events after replay and closes on the terminal event', async () => {
    const harness = createHarness('running');
    await new ProductEventStorePublisher(harness.eventStore).publish(createEvent('run-1', 'event-1', 'research.started'));
    const controller = new AbortController();
    const response = await harness.handler(
      new Request('http://localhost/api/research/run-1/events', { signal: controller.signal }),
      { params: { id: 'run-1' } },
    );
    const reader = response.body!.getReader();
    expect(await readNext(reader)).toContain('id: 1');

    const publisher = new ProductEventStorePublisher(harness.eventStore, harness.liveEventPublisher);
    await publisher.publish(createEvent('run-1', 'event-2', 'research.completed'));

    const live = await readNext(reader);
    expect(live).toContain('id: 2');
    expect(live).toContain('event: research.completed');
    expect((await reader.read()).done).toBe(true);
  });

  it('does not lose an event produced while initial replay is in progress', async () => {
    const harness = createHarness('completed');
    await new ProductEventStorePublisher(harness.eventStore).publish(createEvent('run-1', 'event-1', 'research.started'));
    let releaseFirstRead: (() => void) | undefined;
    harness.eventStore.blockFirstRead = new Promise<void>((resolve) => {
      releaseFirstRead = resolve;
    });
    const responsePromise = harness.handler(
      new Request('http://localhost/api/research/run-1/events'),
      { params: { id: 'run-1' } },
    );
    await Promise.resolve();
    await new ProductEventStorePublisher(harness.eventStore, harness.liveEventPublisher)
      .publish(createEvent('run-1', 'event-2', 'research.completed'));
    releaseFirstRead?.();

    const body = await readAll(await responsePromise);
    expect(body.match(/id: 2/g)).toHaveLength(1);
    expect(body.indexOf('id: 1')).toBeLessThan(body.indexOf('id: 2'));
  });

  it('returns 404 for a missing run', async () => {
    const eventStore = new MemoryEventStore();
    const handler = createResearchEventsGetHandler(() => ({
      runs: { findById: async () => null },
      eventStore,
      liveEventPublisher: new InMemoryLiveEventPublisher(),
    }));

    const response = await handler(
      new Request('http://localhost/api/research/missing/events'),
      { params: { id: 'missing' } },
    );

    expect(response.status).toBe(404);
  });
});
