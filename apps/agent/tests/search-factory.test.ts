import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SearchConfigError } from '@product-scout/config';
import { createSearchTool } from '../src/search';

const context = { sessionId: 'session-1', researchRunId: 'run-1', toolInvocationId: 'tool-1' };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('createSearchTool', () => {
  it('loads in a real Node/tsx process and reports missing config without making a request', () => {
    const result = spawnSync(process.execPath, [
      '--import', 'tsx', fileURLToPath(new URL('../src/search/smoke.ts', import.meta.url)), 'HVAC',
    ], {
      env: { ...process.env, SEARCH_PROVIDER: '', SEARCH_API_KEY: '' },
      encoding: 'utf8', timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SEARCH_PROVIDER must be brave or tavily');
    expect(result.stderr).not.toContain('SyntaxError');
    expect(result.stdout).toBe('');
  }, 15_000);

  it.each(['', 'mock', 'unknown'])('rejects missing/unsupported providers instead of selecting mock: %s', (name) => {
    vi.stubEnv('SEARCH_PROVIDER', name);
    expect(() => createSearchTool()).toThrow(SearchConfigError);
  });

  it('requires a key for real searches', () => {
    vi.stubEnv('SEARCH_PROVIDER', 'brave');
    vi.stubEnv('SEARCH_API_KEY', '');
    expect(() => createSearchTool()).toThrow(SearchConfigError);
  });

  it('reads environment only when creating the tool and calls the real adapter', async () => {
    vi.stubEnv('SEARCH_PROVIDER', 'tavily');
    vi.stubEnv('SEARCH_API_KEY', 'test-secret');
    vi.stubEnv('SEARCH_BASE_URL', '');
    vi.stubEnv('SEARCH_TIMEOUT_MS', '1000');
    vi.stubEnv('SEARCH_MAX_RESPONSE_BYTES', '4096');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      results: [{ title: 'Market', url: 'https://example.test/market', content: 'Market signal' }],
    }))));
    await expect(createSearchTool().execute({ query: 'market' }, context)).resolves.toMatchObject({
      items: [{ snippet: 'Market signal' }],
    });
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toBe('https://api.tavily.com/search');
  });

  it('supports explicit config injection without reading process env', async () => {
    vi.stubEnv('SEARCH_PROVIDER', '');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ web: { results: [] } }))));
    const tool = createSearchTool({ provider: 'brave', apiKey: 'test-secret', timeoutMs: 1000, maxResponseBytes: 4096 });
    await expect(tool.execute({ query: 'market' }, context)).resolves.toEqual({ query: 'market', items: [] });
  });
});
