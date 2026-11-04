import { describe, expect, it } from 'vitest';
import { readConfig, readSearchConfig, SearchConfigError } from '../src';

const env = { SEARCH_PROVIDER: 'brave', SEARCH_API_KEY: 'test-secret' };

describe('readSearchConfig', () => {
  it('uses bounded defaults without changing existing application config', () => {
    expect(readSearchConfig(env)).toEqual({
      provider: 'brave', apiKey: 'test-secret', timeoutMs: 10_000, maxResponseBytes: 1_048_576,
    });
    expect(readConfig({})).toEqual({ databaseUrl: '', appUrl: 'http://localhost:3000' });
  });

  it('reads explicit Tavily configuration and trims strings', () => {
    expect(readSearchConfig({
      SEARCH_PROVIDER: ' tavily ', SEARCH_API_KEY: ' secret ',
      SEARCH_BASE_URL: ' https://search.example.test/search ',
      SEARCH_TIMEOUT_MS: '500', SEARCH_MAX_RESPONSE_BYTES: '4096',
    })).toEqual({
      provider: 'tavily', apiKey: 'secret', baseUrl: 'https://search.example.test/search',
      timeoutMs: 500, maxResponseBytes: 4096,
    });
  });

  it('treats a blank optional endpoint as the provider default', () => {
    expect(readSearchConfig({ ...env, SEARCH_BASE_URL: ' ' }).baseUrl).toBeUndefined();
  });

  it.each([{}, { SEARCH_PROVIDER: 'mock' }, { SEARCH_PROVIDER: 'brave' },
    { ...env, SEARCH_API_KEY: ' ' }, { ...env, SEARCH_API_KEY: 'secret\r\nheader' }])(
    'rejects missing or unsupported credentials/configuration without mock fallback: %j', (input) => {
      expect(() => readSearchConfig(input)).toThrow(SearchConfigError);
    },
  );

  it.each(['not-a-url', 'http://search.test/search', 'https://user:secret@search.test/',
    'https://search.test/search?key=secret', 'https://search.test/search#fragment'])(
    'rejects unsafe endpoints without echoing their contents: %s', (baseUrl) => {
      expect(() => readSearchConfig({ ...env, SEARCH_BASE_URL: baseUrl })).toThrow(SearchConfigError);
      expect(() => readSearchConfig({ ...env, SEARCH_BASE_URL: baseUrl })).not.toThrow(baseUrl);
    },
  );

  it.each(['', ' ', '0', '-1', '1.5', 'NaN', 'Infinity', '1e3', '9007199254740992'])(
    'rejects invalid numeric settings: %s', (value) => {
      expect(() => readSearchConfig({ ...env, SEARCH_TIMEOUT_MS: value })).toThrow(SearchConfigError);
      expect(() => readSearchConfig({ ...env, SEARCH_MAX_RESPONSE_BYTES: value })).toThrow(SearchConfigError);
    },
  );

  it('rejects timeouts that would overflow the Node timer', () => {
    expect(() => readSearchConfig({ ...env, SEARCH_TIMEOUT_MS: '2147483648' })).toThrow(SearchConfigError);
  });
});
