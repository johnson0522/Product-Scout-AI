import { randomUUID } from 'node:crypto';

const BASE_URL = 'https://api.yunqiao.me/v1';
const MODEL = 'gpt-6.1-sol';
const MAX_BYTES = 1_048_576;
const TIMEOUT_MS = 60_000;

type JsonObject = Readonly<Record<string, unknown>>;
type Fetch = typeof globalThis.fetch;

export interface SmokeResult {
  readonly check: 'model_access' | 'model_call' | 'text_stream' | 'tool_roundtrip';
  readonly status: 'PASS';
  readonly detail: string;
}

function object(value: unknown): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected a JSON object');
  }
  return value as JsonObject;
}

function json(text: string): JsonObject {
  try {
    return object(JSON.parse(text));
  } catch {
    throw new Error('Malformed JSON response (body omitted)');
  }
}

/** Developer diagnostic only. Never registered as a production Agent tool. */
export function executeSmokeAdd(argumentsText: string): { readonly sum: number } {
  const args = json(argumentsText);
  if (Object.keys(args).length !== 2 || args.a !== 19 || args.b !== 23) {
    throw new Error('Smoke tool requires exactly { a: 19, b: 23 }');
  }
  return { sum: args.a + args.b };
}

async function readBody(response: Response, consume: (text: string) => void): Promise<void> {
  if (response.body === null) throw new Error('Response body is missing');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error('Response exceeded the one-MiB diagnostic limit');
      consume(decoder.decode(value, { stream: true }));
    }
    consume(decoder.decode());
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

interface StreamResult {
  readonly response: JsonObject;
  readonly textDeltas: number;
  readonly argumentDeltas: string;
  readonly argumentDeltaCount: number;
}

/** Parse SSE independently of network chunk boundaries; never expose reasoning events. */
export async function readResponseStream(response: Response): Promise<StreamResult> {
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
    throw new Error('Expected text/event-stream');
  }
  let pending = '';
  let data: string[] = [];
  let completed: JsonObject | undefined;
  let textDeltas = 0;
  let argumentDeltas = '';
  let argumentDeltaCount = 0;
  const dispatch = (): void => {
    if (data.length === 0) return;
    const text = data.join('\n');
    data = [];
    if (text === '[DONE]') return;
    const event = json(text);
    if (event.type === 'error' || event.type === 'response.failed'
      || event.type === 'response.incomplete') {
      throw new Error('Provider emitted a failed/incomplete stream event (body omitted)');
    }
    if (event.type === 'response.output_text.delta') {
      if (typeof event.delta !== 'string') throw new Error('Invalid text delta');
      if (event.delta.length > 0) textDeltas += 1;
    }
    if (event.type === 'response.function_call_arguments.delta') {
      if (typeof event.delta !== 'string') throw new Error('Invalid tool arguments delta');
      argumentDeltas += event.delta;
      argumentDeltaCount += 1;
    }
    if (event.type === 'response.completed') {
      if (completed !== undefined) throw new Error('Duplicate stream completion');
      completed = object(event.response);
    }
  };
  const line = (value: string): void => {
    if (value === '') dispatch();
    else if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /u, ''));
  };
  await readBody(response, (chunk) => {
    pending += chunk;
    // SSE permits CR, LF and CRLF, including CRLF split across network chunks.
    for (;;) {
      const match = /[\r\n]/u.exec(pending);
      if (match === null) break;
      const index = match.index;
      if (pending[index] === '\r' && index === pending.length - 1) break;
      const width = pending[index] === '\r' && pending[index + 1] === '\n' ? 2 : 1;
      line(pending.slice(0, index));
      pending = pending.slice(index + width);
    }
  });
  if (pending.endsWith('\r')) { line(pending.slice(0, -1)); pending = ''; }
  if (pending.length > 0 || data.length > 0) throw new Error('Truncated SSE frame');
  if (completed === undefined) throw new Error('Stream ended without response.completed');
  requireCompleted(completed);
  return { response: completed, textDeltas, argumentDeltas, argumentDeltaCount };
}

function requireCompleted(response: JsonObject): void {
  if (response.status !== 'completed' || !Array.isArray(response.output)) {
    throw new Error('Response did not complete with an output array');
  }
}

function outputText(response: JsonObject): string {
  requireCompleted(response);
  const items: readonly unknown[] = Array.isArray(response.output) ? response.output : [];
  return items.flatMap((value) => {
    const item = object(value);
    if (item.type !== 'message' || !Array.isArray(item.content)) return [];
    return item.content.flatMap((part: unknown) => {
      const content = object(part);
      return content.type === 'output_text' && typeof content.text === 'string' ? [content.text] : [];
    });
  }).join('').trim();
}

const TOOL = {
  type: 'function',
  name: 'product_scout_smoke_add',
  description: 'Compute 19 + 23 in a harmless connectivity check.',
  strict: true,
  parameters: {
    type: 'object',
    properties: { a: { type: 'integer' }, b: { type: 'integer' } },
    required: ['a', 'b'],
    additionalProperties: false,
  },
};

export async function runYunqiaoSmoke(
  apiKey: string,
  report: (result: SmokeResult) => void,
  fetchImpl: Fetch = globalThis.fetch,
): Promise<void> {
  if (!apiKey.trim()) throw new Error('LLM_API_KEY is required');
  async function request(path: string, body?: JsonObject, stream = false): Promise<StreamResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetchImpl(`${BASE_URL}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: stream ? 'text/event-stream' : 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        redirect: 'error',
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        let code = '';
        try {
          let text = '';
          await readBody(response, (chunk) => { text += chunk; });
          const body = json(text);
          const error = body.error === undefined ? body : object(body.error);
          // Report only a bounded machine code, never raw provider messages/bodies.
          if (typeof error.code === 'string' && /^[A-Z_]{1,48}$/u.test(error.code)
            && !error.code.includes(apiKey)) code = ` ${error.code}`;
        } catch { /* HTTP status is still reported for non-JSON/oversized bodies. */ }
        throw new Error(`Yunqiao ${path}: HTTP ${response.status}${code} (body omitted)`);
      }
      if (stream) return await readResponseStream(response);
      let text = '';
      await readBody(response, (chunk) => { text += chunk; });
      return { response: json(text), textDeltas: 0, argumentDeltas: '', argumentDeltaCount: 0 };
    } catch (error: unknown) {
      if (controller.signal.aborted) throw new Error(`Yunqiao ${path}: timed out after ${TIMEOUT_MS} ms`);
      // Only expose our own validation messages, never fetch errors containing credentials.
      if (error instanceof Error && error.message.includes(apiKey)) {
        throw new Error('Yunqiao request failed (sensitive details omitted)');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  async function post(body: JsonObject, stream = false): Promise<StreamResult> {
    return request('/responses', { model: MODEL, max_output_tokens: 2048, store: false, ...body }, stream);
  }
  const catalog = (await request('/models')).response;
  if (!Array.isArray(catalog.data) || !catalog.data.some((entry: unknown) => object(entry).id === MODEL)) {
    throw new Error(`${MODEL} was not listed for this key; no model requests were sent`);
  }
  report({ check: 'model_access', status: 'PASS', detail: `${MODEL} listed by /v1/models` });

  const plain = await post({ input: 'Reply with exactly PSC_MODEL_OK. No explanation.' });
  if (outputText(plain.response) !== 'PSC_MODEL_OK') throw new Error('Non-streaming response did not match the test marker');
  report({ check: 'model_call', status: 'PASS', detail: 'Completed response with expected text' });

  const textStream = await post({ input: 'Reply with exactly PSC_STREAM_OK. No explanation.', stream: true }, true);
  if (textStream.textDeltas === 0 || outputText(textStream.response) !== 'PSC_STREAM_OK') {
    throw new Error('Expected text delta events and completed text marker');
  }
  report({ check: 'text_stream', status: 'PASS', detail: `${textStream.textDeltas} text delta events and response.completed` });

  const toolInput = [{ role: 'user', content: 'Call product_scout_smoke_add exactly once with a=19 and b=23.' }];
  const toolStream = await post({
    input: toolInput, tools: [TOOL], parallel_tool_calls: false,
    tool_choice: { type: 'function', name: TOOL.name }, stream: true,
  }, true);
  const output: readonly unknown[] = Array.isArray(toolStream.response.output) ? toolStream.response.output : [];
  const calls = output.map(object).filter((item) => item.type === 'function_call');
  const call = calls[0];
  if (calls.length !== 1 || call?.name !== TOOL.name || typeof call.call_id !== 'string'
    || typeof call.arguments !== 'string' || toolStream.argumentDeltaCount === 0
    || toolStream.argumentDeltas !== call.arguments) {
    throw new Error('Expected one streamed function call with matching completed arguments');
  }
  const result = executeSmokeAdd(call.arguments);
  const receipt = `PSC_TOOL_OK_${randomUUID()}`;
  const final = await post({
    input: [
      ...toolInput, ...output,
      { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ ...result, receipt }) },
      { role: 'user', content: 'Reply with exactly the receipt returned by the tool if sum is 42. No explanation.' },
    ],
    tools: [TOOL], tool_choice: 'none',
  });
  if (outputText(final.response) !== receipt) throw new Error('Model did not acknowledge the actual tool result');
  report({ check: 'tool_roundtrip', status: 'PASS', detail: `Validated arguments, ${toolStream.argumentDeltaCount} argument deltas, local sum=42, result receipt acknowledged` });
}
