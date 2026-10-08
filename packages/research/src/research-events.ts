import type { ProductEvent, ResearchRunId } from '@product-scout/domain';
import type { AgentEvent } from '@product-scout/agent-sdk';

export type ResearchEvent = ProductEvent;
export type { ProductEvent };

/** A durable event with its per-research-run replay cursor. */
export type StoredProductEvent = ProductEvent & {
  readonly sequenceNumber?: number;
};

export interface ProductEventStore {
  append(event: ProductEvent): Promise<void>;
  listByResearchRunId(
    researchRunId: ResearchRunId,
    afterSequenceNumber?: number,
  ): Promise<readonly StoredProductEvent[]>;
}

export interface ResearchEventPublisher {
  publish(event: ResearchEvent): Promise<void>;
}

export type ProductEventListener = (event: ProductEvent) => void;
export type Unsubscribe = () => void;

export interface LiveEventPublisher {
  publish(event: ProductEvent): void;
  subscribe(researchRunId: ResearchRunId, listener: ProductEventListener): Unsubscribe;
}

/** Process-local notification registry. Durable storage remains the source of truth. */
export class InMemoryLiveEventPublisher implements LiveEventPublisher {
  private readonly subscribers = new Map<ResearchRunId, Set<ProductEventListener>>();

  public publish(event: ProductEvent): void {
    const listeners = this.subscribers.get(event.researchRunId);
    if (listeners === undefined) {
      return;
    }

    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        // A subscriber is isolated from the publisher and other subscribers.
      }
    }
  }

  public subscribe(
    researchRunId: ResearchRunId,
    listener: ProductEventListener,
  ): Unsubscribe {
    let listeners = this.subscribers.get(researchRunId);
    if (listeners === undefined) {
      listeners = new Set<ProductEventListener>();
      this.subscribers.set(researchRunId, listeners);
    }
    listeners.add(listener);

    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      listeners?.delete(listener);
      if (listeners?.size === 0) {
        this.subscribers.delete(researchRunId);
      }
    };
  }

  public subscriberCount(researchRunId?: ResearchRunId): number {
    if (researchRunId !== undefined) {
      return this.subscribers.get(researchRunId)?.size ?? 0;
    }
    let count = 0;
    for (const listeners of this.subscribers.values()) {
      count += listeners.size;
    }
    return count;
  }
}

export class ProductEventStorePublisher implements ResearchEventPublisher {
  public constructor(
    private readonly store: ProductEventStore,
    private readonly livePublisher?: LiveEventPublisher,
  ) {}

  public async publish(event: ProductEvent): Promise<void> {
    await this.store.append(event);
    this.livePublisher?.publish(event);
  }
}

export class NoopResearchEventPublisher implements ResearchEventPublisher {
  public async publish(_event: ResearchEvent): Promise<void> {}
}

export function toResearchEvent(
  researchRunId: ResearchRunId,
  event: AgentEvent,
): ResearchEvent {
  const base = {
    eventId: event.eventId,
    researchRunId,
    occurredAt: event.occurredAt,
  };

  switch (event.type) {
    case 'agent.started':
      return { ...base, type: 'research.started' };
    case 'research.step.started':
      return {
        ...base,
        type: 'research.step.started',
        stepId: event.stepId,
        stepType: event.stepType,
      };
    case 'tool.started':
      return {
        ...base,
        type: 'research.tool.started',
        toolInvocationId: event.toolInvocationId,
        toolName: event.toolName,
      };
    case 'tool.completed':
      return {
        ...base,
        type: 'research.tool.completed',
        toolInvocationId: event.toolInvocationId,
        toolName: event.toolName,
        success: event.success,
        ...(event.errorMessage === undefined ? {} : { errorMessage: event.errorMessage }),
      };
    case 'evidence.created':
      return {
        ...base,
        type: 'research.evidence.created',
        evidenceId: event.evidenceId,
        sourceId: event.sourceId,
      };
    case 'research.step.completed':
      return {
        ...base,
        type: 'research.step.completed',
        stepId: event.stepId,
        stepType: event.stepType,
        success: event.success,
        ...(event.errorMessage === undefined ? {} : { errorMessage: event.errorMessage }),
      };
    case 'opportunity.created':
      return {
        ...base,
        type: 'research.opportunity.created',
        opportunityId: event.opportunityId,
      };
    case 'agent.completed':
      return { ...base, type: 'research.completed' };
    case 'agent.failed':
      return {
        ...base,
        type: 'research.failed',
        errorMessage: event.errorMessage,
        recoverable: event.recoverable,
      };
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported agent event: ${String(value)}`);
}
