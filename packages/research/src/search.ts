import type {
  AgentEvent,
  AgentSessionId,
  ToolCompletedEvent,
  ToolStartedEvent,
} from '@product-scout/agent-sdk';
import type { ResearchRunId } from '@product-scout/domain';

export interface SearchQuery {
  readonly query: string;
  readonly limit?: number;
}

export interface SearchResultItem {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

export interface SearchResult {
  readonly query: string;
  readonly items: readonly SearchResultItem[];
}

export interface SearchProvider {
  search(query: SearchQuery): Promise<SearchResult>;
}

export interface SearchToolInput {
  readonly query: string;
  readonly limit?: number;
}

export interface SearchToolContext {
  readonly sessionId: AgentSessionId;
  readonly researchRunId: ResearchRunId;
  readonly toolInvocationId: string;
  readonly now?: () => Date;
  readonly emit?: (event: ToolStartedEvent | ToolCompletedEvent) => void;
}

export class SearchToolInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SearchToolInputError';
  }
}

export class SearchToolExecutionError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SearchToolExecutionError';
  }
}

/** Agent-facing search capability. It depends only on the provider contract. */
export class SearchTool {
  public constructor(private readonly provider: SearchProvider) {}

  public async execute(
    input: SearchToolInput,
    context: SearchToolContext,
  ): Promise<SearchResult> {
    const query = validateQuery(input);
    const now = context.now ?? (() => new Date());
    const startedAt = now();
    context.emit?.({
      type: 'tool.started',
      eventId: `${context.toolInvocationId}:started`,
      sessionId: context.sessionId,
      occurredAt: startedAt,
      toolInvocationId: context.toolInvocationId,
      toolName: 'search',
    });

    try {
      const result = await this.provider.search(query);
      context.emit?.({
        type: 'tool.completed',
        eventId: `${context.toolInvocationId}:completed`,
        sessionId: context.sessionId,
        occurredAt: now(),
        toolInvocationId: context.toolInvocationId,
        toolName: 'search',
        success: true,
      });
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      context.emit?.({
        type: 'tool.completed',
        eventId: `${context.toolInvocationId}:completed`,
        sessionId: context.sessionId,
        occurredAt: now(),
        toolInvocationId: context.toolInvocationId,
        toolName: 'search',
        success: false,
        errorMessage: message,
      });
      throw new SearchToolExecutionError(`Search provider failed: ${message}`, {
        cause: error,
      });
    }
  }
}

function validateQuery(input: SearchToolInput): SearchQuery {
  if (typeof input.query !== 'string' || input.query.trim() === '') {
    throw new SearchToolInputError('query must be a non-empty string');
  }

  if (input.limit !== undefined
    && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100)) {
    throw new SearchToolInputError('limit must be an integer between 1 and 100');
  }

  return {
    query: input.query.trim(),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  };
}

export type SearchToolEvent = Extract<AgentEvent, { type: 'tool.started' | 'tool.completed' }>;
