import { describe, expect, it, vi } from 'vitest';
import { HttpsWebFetcher, isPublicIpv4 } from '../src/web-fetch';
import { SourceResearchSearch } from '../src/source-research';

describe('public HTTPS fetch boundary', () => {
  it.each(['127.0.0.1', '10.0.0.1', '169.254.169.254', '172.16.1.1', '192.168.1.1', '100.64.0.1', '198.18.0.1', '0.0.0.0', '224.0.0.1', '::1', '::ffff:127.0.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.1'])('rejects private/reserved address %s', (address) => {
    expect(isPublicIpv4(address)).toBe(false);
  });
  it.each(['http://example.com', 'https://localhost', 'https://example.com:444', 'https://user:secret@example.com', 'file:///etc/passwd', 'https://[::1]'])('rejects unsafe destination %s', async (url) => {
    const transport = vi.fn();
    const web = new HttpsWebFetcher({ resolveAddresses: async () => ['127.0.0.1'], transport });
    await expect(web.fetch({ url })).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it('rejects mixed DNS answers and pins a public address to transport', async () => {
    const transport = vi.fn(async () => ({ body: '<script>secret()</script><h1>Original &amp; evidence</h1>', contentType: 'text/html' }));
    await expect(new HttpsWebFetcher({ resolveAddresses: async () => ['93.184.216.34', '10.0.0.1'], transport }).fetch({ url: 'https://example.com' })).rejects.toThrow('public IPv4');
    expect(transport).not.toHaveBeenCalled();
    const result = await new HttpsWebFetcher({ resolveAddresses: async () => ['93.184.216.34'], transport }).fetch({ url: 'https://example.com/page#fragment' });
    expect(result.text).toBe('Original & evidence');
    expect(transport.mock.calls[0]?.[1]).toBe('93.184.216.34');
    expect(result.url).toBe('https://example.com/page');
  });
  it('bounds DNS resolution by the same deadline and rejects unsupported content', async () => {
    const stalled = new HttpsWebFetcher({ timeoutMs: 10, resolveAddresses: () => new Promise(() => {}) });
    await expect(stalled.fetch({ url: 'https://example.com' })).rejects.toThrow('timed out');
    const web = new HttpsWebFetcher({ resolveAddresses: async () => ['93.184.216.34'], transport: async () => ({ body: 'binary', contentType: 'application/pdf' }) });
    await expect(web.fetch({ url: 'https://example.com' })).rejects.toThrow('content type');
  });
  it('enforces the response byte limit and returns only the bounded original excerpt', async () => {
    const transport = async () => ({ body: 'original observation repeated', contentType: 'text/plain' });
    await expect(new HttpsWebFetcher({ maxBytes: 10, resolveAddresses: async () => ['93.184.216.34'], transport }).fetch({ url: 'https://example.com' })).rejects.toThrow('size limit');
    const page = await new HttpsWebFetcher({ maxTextCharacters: 8, resolveAddresses: async () => ['93.184.216.34'], transport }).fetch({ url: 'https://example.com' });
    expect(page.text).toBe('original');
  });
});

describe('source research integration (injected ports)', () => {
  it('persists fetched source metadata, retains fallback snippets, and awaits events', async () => {
    const events: string[] = [];
    const sources: string[] = [];
    const search = new SourceResearchSearch({ execute: async () => ({ query: 'test', items: [
      { url: 'https://first.example', title: 'First', snippet: 'Search first' },
      { url: 'https://second.example', title: 'Second', snippet: 'Verbatim fallback' },
    ] }) }, { fetch: async ({ url }) => {
      if (url.includes('second')) throw new Error('unavailable');
      return { url, text: 'Fetched original excerpt', retrievedAt: new Date() };
    } }, { create: async (input) => { sources.push(input.url); return { ...input, id: `source-${sources.length}` }; } });
    const result = await search.execute({ query: 'test' }, { sessionId: 'session', researchRunId: 'run', toolInvocationId: 'tool', emit: async (event) => { events.push(event.type); } });
    expect(result.items.map((item) => item.snippet)).toEqual(['Fetched original excerpt', 'Verbatim fallback']);
    expect(result.items.map((item) => item.sourceId)).toEqual(['source-1', 'source-2']);
    expect(sources).toHaveLength(2);
    expect(events).toEqual(['tool.started', 'tool.completed', 'tool.started', 'tool.completed']);
  });
  it('does not persist a source after cancellation during fetch', async () => {
    let cancelled = false;
    const create = vi.fn();
    const search = new SourceResearchSearch({ execute: async () => ({ query: 'q', items: [{ title: 't', url: 'https://example.com', snippet: 's' }] }) }, { fetch: async () => { cancelled = true; return { url: 'https://example.com', text: 'page', retrievedAt: new Date() }; } }, { create });
    await expect(search.execute({ query: 'q' }, { sessionId: 's', researchRunId: 'r', toolInvocationId: 't', isCancelled: () => cancelled })).rejects.toThrow('cancelled');
    expect(create).not.toHaveBeenCalled();
  });
});
