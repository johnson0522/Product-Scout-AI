import { describe, expect, it } from 'vitest';
import type { ToolCompletedEvent, ToolStartedEvent } from '@product-scout/agent-sdk';

import {
  SearchTool,
  SearchToolExecutionError,
  SearchToolInputError,
  type SearchProvider,
} from '../src';

describe('SearchTool', () => {
  const context = {
    sessionId: 'session-1',
    researchRunId: 'run-1',
    toolInvocationId: 'tool-1',
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  } as const;

  it('depends on an injected provider and emits tool events in order', async () => {
    const events: (ToolStartedEvent | ToolCompletedEvent)[] = [];
    const provider: SearchProvider = {
      search: async (query) => ({
        query: query.query,
        items: [{ title: 'Result', url: 'https://example.test/result', snippet: 'Snippet' }],
      }),
    };
    const result = await new SearchTool(provider).execute(
      { query: ' product opportunity ', limit: 1 },
      { ...context, emit: (event) => events.push(event) },
    );

    expect(result).toEqual({
      query: 'product opportunity',
      items: [{ title: 'Result', url: 'https://example.test/result', snippet: 'Snippet' }],
    });
    expect(events.map((event) => event.type)).toEqual(['tool.started', 'tool.completed']);
    expect(events[0]).toMatchObject({ toolName: 'search', toolInvocationId: 'tool-1' });
    expect(events[1]).toMatchObject({ toolName: 'search', success: true });
  });

  it('rejects invalid input before calling the provider', async () => {
    let calls = 0;
    const provider: SearchProvider = {
      search: async () => {
        calls += 1;
        return { query: 'unused', items: [] };
      },
    };

    await expect(new SearchTool(provider).execute({ query: ' ' }, context))
      .rejects.toBeInstanceOf(SearchToolInputError);
    await expect(new SearchTool(provider).execute({ query: 'valid', limit: 0 }, context))
      .rejects.toBeInstanceOf(SearchToolInputError);
    expect(calls).toBe(0);
  });

  it('emits a failed tool.completed event and rethrows provider errors', async () => {
    const events: (ToolStartedEvent | ToolCompletedEvent)[] = [];
    const provider: SearchProvider = {
      search: async () => {
        throw new Error('provider unavailable');
      },
    };

    await expect(new SearchTool(provider).execute(
      { query: 'known' },
      { ...context, emit: (event) => events.push(event) },
    )).rejects.toBeInstanceOf(SearchToolExecutionError);
    expect(events.map((event) => event.type)).toEqual(['tool.started', 'tool.completed']);
    expect(events[1]).toMatchObject({ success: false, errorMessage: 'provider unavailable' });
  });
});
