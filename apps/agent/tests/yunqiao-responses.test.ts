import { describe, expect, it } from 'vitest';
import { executeSmokeAdd, readResponseStream, runYunqiaoSmoke } from '../src/diagnostics/yunqiao-responses';
import type { SmokeResult } from '../src/diagnostics/yunqiao-responses';

function completed(text: string): Record<string, unknown> {
  return { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] };
}

function sse(events: readonly unknown[], newline = '\n'): Response {
  const text = events.map((event) => `data: ${JSON.stringify(event)}${newline}${newline}`).join('');
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === bytes.length) controller.close();
      else controller.enqueue(bytes.slice(offset, ++offset));
    },
  }), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
}

describe('Yunqiao Responses developer diagnostic (mock transport, no network)', () => {
  it('executes only the fixed, validated local addition', () => {
    expect(executeSmokeAdd('{"a":19,"b":23}')).toEqual({ sum: 42 });
    for (const invalid of ['null', '{"a":"19","b":23}', '{"a":19,"b":23,"extra":true}', '{"a":0,"b":23}', 'invalid']) {
      expect(() => executeSmokeAdd(invalid)).toThrow();
    }
  });

  it.each(['\n', '\r\n', '\r'])('parses SSE with %j separators split across byte boundaries', async (separator) => {
    const result = await readResponseStream(sse([
      { type: 'response.output_text.delta', delta: '你好' },
      { type: 'response.completed', response: completed('你好') },
    ], separator));
    expect(result.textDeltas).toBe(1);
    expect(result.response).toEqual(completed('你好'));
  });

  it('rejects failed, incomplete, missing and duplicate stream completion', async () => {
    for (const type of ['error', 'response.failed', 'response.incomplete']) {
      await expect(readResponseStream(sse([{ type }]))).rejects.toThrow();
    }
    await expect(readResponseStream(sse([]))).rejects.toThrow('without response.completed');
    const event = { type: 'response.completed', response: completed('OK') };
    await expect(readResponseStream(sse([event, event]))).rejects.toThrow('Duplicate');
    await expect(readResponseStream(new Response('data: {}', {
      headers: { 'Content-Type': 'text/event-stream' },
    }))).rejects.toThrow('Truncated');
    await expect(readResponseStream(new Response('{}'))).rejects.toThrow('text/event-stream');
  });

  it('bounds the streamed response size', async () => {
    await expect(readResponseStream(new Response('x'.repeat(1_048_577), {
      headers: { 'Content-Type': 'text/event-stream' },
    }))).rejects.toThrow('one-MiB');
  });

  it.each([true, false])('stops on disabled key group (nested error: %s) without exposing the body or sending model calls', async (nested) => {
    const calls: string[] = [];
    const transport: typeof fetch = async (url) => {
      calls.push(String(url));
      const error = { code: 'GROUP_DISABLED', message: 'private-provider-details' };
      return Response.json(nested ? { error } : error, { status: 403 });
    };
    await expect(runYunqiaoSmoke('private-key', () => undefined, transport))
      .rejects.toThrow('HTTP 403 GROUP_DISABLED (body omitted)');
    expect(calls).toEqual(['https://api.yunqiao.me/v1/models']);
  });

  it('does not substitute another model when the requested ID is absent', async () => {
    let calls = 0;
    const transport: typeof fetch = async () => {
      calls += 1;
      return Response.json({ data: [{ id: 'another-model' }] });
    };
    await expect(runYunqiaoSmoke('private-key', () => undefined, transport)).rejects.toThrow('not listed');
    expect(calls).toBe(1);
  });

  it('checks the complete streamed tool/result roundtrip using a random receipt', async () => {
    const reports: SmokeResult[] = [];
    let calls = 0;
    const functionCall = {
      id: 'fc_test', type: 'function_call', name: 'product_scout_smoke_add',
      call_id: 'call_test', arguments: '{"a":19,"b":23}', status: 'completed',
    };
    const transport: typeof fetch = async (url, options) => {
      calls += 1;
      expect(String(url)).toMatch(/^https:\/\/api\.yunqiao\.me\/v1\/(models|responses)$/u);
      expect(options?.redirect).toBe('error');
      expect(new Headers(options?.headers).get('authorization')).toBe('Bearer private-key');
      if (calls === 1) return Response.json({ data: [{ id: 'gpt-6.1-sol' }] });
      const body: Record<string, unknown> = JSON.parse(String(options?.body));
      expect(body.model).toBe('gpt-6.1-sol');
      expect(body.store).toBe(false);
      expect(body.max_output_tokens).toBe(2048);
      if (calls === 2) return Response.json(completed('PSC_MODEL_OK'));
      if (calls === 3) return sse([
        { type: 'response.output_text.delta', delta: 'PSC_STREAM_OK' },
        { type: 'response.completed', response: completed('PSC_STREAM_OK') },
      ]);
      if (calls === 4) return sse([
        { type: 'response.function_call_arguments.delta', delta: '{"a":19,' },
        { type: 'response.function_call_arguments.delta', delta: '"b":23}' },
        { type: 'response.completed', response: { status: 'completed', output: [functionCall] } },
      ]);
      expect(calls).toBe(5);
      expect(body.tool_choice).toBe('none');
      const input = body.input as Record<string, unknown>[];
      const result = input.find((entry) => entry.type === 'function_call_output');
      expect(result?.call_id).toBe('call_test');
      const output = JSON.parse(String(result?.output)) as { sum: number; receipt: string };
      expect(output.sum).toBe(42);
      expect(output.receipt).toMatch(/^PSC_TOOL_OK_/u);
      return Response.json(completed(output.receipt));
    };
    await runYunqiaoSmoke('private-key', (result) => reports.push(result), transport);
    expect(reports.map((result) => result.check)).toEqual(['model_access', 'model_call', 'text_stream', 'tool_roundtrip']);
    expect(calls).toBe(5);
  });
});
