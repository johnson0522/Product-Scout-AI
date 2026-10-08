import type { ProductEvent, ResearchRunId, ResearchRunStatus } from '@product-scout/domain';
import type {
  LiveEventPublisher,
  ProductEventStore,
  StoredProductEvent,
} from '@product-scout/research';

export interface ResearchEventStreamDependencies {
  readonly runs: {
    findById(id: ResearchRunId): Promise<{ readonly status: ResearchRunStatus } | null>;
  };
  readonly eventStore: ProductEventStore;
  readonly liveEventPublisher: LiveEventPublisher;
  readonly heartbeatIntervalMs?: number;
}

export interface ResearchEventsRouteContext {
  readonly params: { readonly id: string };
}

export function createResearchEventsGetHandler(
  resolveDependencies: () => ResearchEventStreamDependencies,
): (
  request: Request,
  context: ResearchEventsRouteContext,
) => Promise<Response> {
  return async (request, context): Promise<Response> => {
    const dependencies = resolveDependencies();
    const run = await dependencies.runs.findById(context.params.id);
    if (run === null) {
      return Response.json({ error: `Research run not found: ${context.params.id}` }, { status: 404 });
    }

    const cursor = parseLastEventId(request.headers.get('last-event-id'));
    if (cursor instanceof Error) {
      return Response.json({ error: cursor.message }, { status: 400 });
    }

    const encoder = new TextEncoder();
    let cancelStream = (): void => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        let closed = false;
        let replaying = true;
        let lastSequence = cursor;
        let terminalEventSeen = isTerminalStatus(run.status);
        const bufferedLiveEvents: ProductEvent[] = [];
        let liveFlush = Promise.resolve();
        let unsubscribe: (() => void) | undefined;
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        let abort = (): void => close();

        const cleanup = (): void => {
          if (heartbeat !== undefined) {
            clearInterval(heartbeat);
            heartbeat = undefined;
          }
          unsubscribe?.();
          unsubscribe = undefined;
          request.signal.removeEventListener('abort', abort);
        };

        const close = (): void => {
          if (closed) {
            return;
          }
          closed = true;
          cleanup();
          controller.close();
        };
        cancelStream = close;

        const fail = (error: unknown): void => {
          if (closed) {
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          try {
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`));
          } finally {
            close();
          }
        };

        const send = (event: StoredProductEvent, fallbackSequence: number): void => {
          const sequence = event.sequenceNumber ?? fallbackSequence;
          if (sequence <= lastSequence) {
            return;
          }
          lastSequence = sequence;
          if (isTerminalEvent(event)) {
            terminalEventSeen = true;
          }
          const payload = JSON.stringify(event);
          controller.enqueue(encoder.encode(`id: ${sequence}\nevent: ${event.type}\ndata: ${payload}\n\n`));
        };

        const flushDurable = async (): Promise<void> => {
          const events = await dependencies.eventStore.listByResearchRunId(
            context.params.id,
            lastSequence,
          );
          let fallbackSequence = lastSequence;
          for (const event of events) {
            fallbackSequence += 1;
            send(event, fallbackSequence);
          }
          if (!replaying && terminalEventSeen) {
            close();
          }
        };

        const onLiveEvent = (event: ProductEvent): void => {
          if (closed) {
            return;
          }
          if (replaying) {
            bufferedLiveEvents.push(event);
            return;
          }
          liveFlush = liveFlush.then(flushDurable).catch(fail);
        };

        abort = (): void => close();
        if (request.signal.aborted) {
          close();
          return;
        }
        request.signal.addEventListener('abort', abort, { once: true });
        unsubscribe = dependencies.liveEventPublisher.subscribe(context.params.id, onLiveEvent);
        const heartbeatInterval = dependencies.heartbeatIntervalMs ?? 15_000;
        heartbeat = setInterval(() => {
          if (!closed) {
            controller.enqueue(encoder.encode(': heartbeat\n\n'));
          }
        }, heartbeatInterval);

        void (async (): Promise<void> => {
          try {
            await flushDurable();
            while (bufferedLiveEvents.length > 0) {
              bufferedLiveEvents.splice(0, bufferedLiveEvents.length);
              await flushDurable();
            }
            replaying = false;
            if (terminalEventSeen) {
              close();
              return;
            }
            await liveFlush;
          } catch (error: unknown) {
            fail(error);
          }
        })();
      },
      cancel(): void {
        cancelStream();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Content-Type': 'text/event-stream; charset=utf-8',
        'X-Accel-Buffering': 'no',
      },
    });
  };
}

function parseLastEventId(value: string | null): number | Error {
  if (value === null || value.trim() === '') {
    return 0;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return new Error('Last-Event-ID must be a non-negative integer');
  }
  return parsed;
}

function isTerminalStatus(status: ResearchRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function isTerminalEvent(event: StoredProductEvent): boolean {
  return event.type === 'research.completed'
    || event.type === 'research.failed'
    || event.type === 'research.cancelled';
}

