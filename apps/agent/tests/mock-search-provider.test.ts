import { describe, expect, it } from 'vitest';

import { MockSearchProvider } from '../src/search/MockSearchProvider';
import { createMockSearchTool } from '../src/search';

describe('MockSearchProvider', () => {
  it('returns deterministic fixture results for a known query', async () => {
    const provider = new MockSearchProvider();
    const first = await provider.search({ query: 'HVAC software' });
    const second = await provider.search({ query: 'HVAC software' });

    expect(first).toEqual(second);
    expect(first.items).toHaveLength(3);
    expect(first.items[0]).toMatchObject({
      title: 'HVAC Business Management Software',
      url: 'https://example.test/hvac-business-management',
    });
    expect(first.items[0]?.snippet).toBeTruthy();
  });

  it('normalizes fixture lookup without changing the requested query', async () => {
    const provider = new MockSearchProvider();
    const result = await provider.search({ query: ' hvac   software ' });

    expect(result.query).toBe(' hvac   software ');
    expect(result.items).toHaveLength(3);
  });

  it('returns an empty result for unknown queries', async () => {
    const provider = new MockSearchProvider();

    await expect(provider.search({ query: 'unknown market' })).resolves.toEqual({
      query: 'unknown market',
      items: [],
    });
  });

  it('respects result limits without changing fixture order', async () => {
    const provider = new MockSearchProvider();

    await expect(provider.search({ query: 'HVAC software', limit: 1 })).resolves.toMatchObject({
      items: [{ title: 'HVAC Business Management Software' }],
    });
    await expect(provider.search({ query: 'HVAC software', limit: 10 })).resolves.toMatchObject({
      items: { length: 3 },
    });
  });

  it('is injected into SearchTool at the agent composition boundary', async () => {
    const result = await createMockSearchTool().execute(
      { query: 'HVAC software', limit: 1 },
      {
        sessionId: 'session-1',
        researchRunId: 'run-1',
        toolInvocationId: 'tool-1',
      },
    );

    expect(result.items).toHaveLength(1);
  });
});
