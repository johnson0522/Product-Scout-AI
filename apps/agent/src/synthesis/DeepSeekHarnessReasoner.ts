import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import type {
  AgentEvent,
  AgentJsonValue,
  AgentReasoningInput,
  AgentReasoningResult,
  AgentRuntimeReasoner,
} from '@product-scout/agent-sdk';

export const SYNTHESIS_TOOL_NAME = 'product_scout_submit_synthesis';

type DshNodeEnvironment = 'production' | 'development' | 'test';
type DshChildEnvironment = Readonly<Record<string, string | undefined>> & {
  readonly NODE_ENV: DshNodeEnvironment;
};

const SYNTHESIS_CHILD_ENV_KEYS = [
  'NODE_ENV',
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'ComSpec',
  'TEMP',
  'TMP',
  'TMPDIR',
  'DEEPSEEK_API_KEY',
  'NODE_EXTRA_CA_CERTS',
] as const;

/** Builds the complete child environment from an explicit credential/runtime allowlist. */
export function createSynthesisChildEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): DshChildEnvironment {
  const allowed: Record<string, string | undefined> = {};
  for (const key of SYNTHESIS_CHILD_ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) allowed[key] = value;
  }
  return { ...allowed, NODE_ENV: nodeEnvironment(source.NODE_ENV) };
}

export interface DeepSeekHarnessReasonerOptions {
  readonly processCwd: string;
  readonly patchFile: string;
  readonly dshHome: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly provider?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly submissionToolName?: string;
  readonly createHarness?: (options: DeepSeekHarnessReasonerHarnessOptions) => ReasoningHarness;
}

export interface DeepSeekHarnessReasonerHarnessOptions {
  readonly profile: 'sdk-minimal';
  readonly patches: string[];
  readonly cwd: string;
  readonly processCwd: string;
  readonly dshHome: string;
  readonly env: DshChildEnvironment;
  readonly initializeTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly provider?: string;
  readonly model?: string;
}

function nodeEnvironment(value: string | undefined): DshNodeEnvironment {
  return value === 'development' || value === 'test' || value === 'production'
    ? value
    : 'production';
}

export interface ReasoningHarnessResult {
  readonly sessionId: string;
  readonly events: readonly unknown[];
}

export interface ReasoningHarness {
  run(prompt: string): Promise<ReasoningHarnessResult>;
  close(): Promise<void>;
}

export class InvalidSynthesisSubmissionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidSynthesisSubmissionError';
  }
}

export class AgentReasoningCancelledError extends Error {
  public constructor(requestId: string) {
    super(`Reasoning request was cancelled: ${requestId}`);
    this.name = 'AgentReasoningCancelledError';
  }
}

interface OwnedReasoningHarness {
  readonly harness: ReasoningHarness;
  closePromise?: Promise<void>;
  cancelled: boolean;
}

/** DSH adapter for one bounded, schema-submitted reasoning operation. */
export class DeepSeekHarnessReasoner implements AgentRuntimeReasoner {
  private readonly active = new Map<string, OwnedReasoningHarness>();
  private readonly timeoutMs: number;

  public constructor(private readonly options: DeepSeekHarnessReasonerOptions) {
    this.timeoutMs = options.timeoutMs ?? 120_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('timeoutMs must be a positive safe integer');
    }
  }

  public async reason(input: AgentReasoningInput): Promise<AgentReasoningResult> {
    if (this.active.has(input.requestId)) {
      throw new Error(`Reasoning request is already active: ${input.requestId}`);
    }
    const owned: OwnedReasoningHarness = {
      harness: this.createHarness(),
      cancelled: false,
    };
    this.active.set(input.requestId, owned);
    try {
      const result = await owned.harness.run(input.prompt);
      if (owned.cancelled) throw new AgentReasoningCancelledError(input.requestId);
      const toolName = this.options.submissionToolName ?? SYNTHESIS_TOOL_NAME;
      const submission = extractStructuredSubmission(result.events, toolName);
      return {
        requestId: input.requestId,
        outputContract: input.outputContract,
        output: submission.output,
        events: mapSubmissionEvents(result.sessionId, submission, toolName),
      };
    } finally {
      this.active.delete(input.requestId);
      await closeOwnedHarness(owned);
    }
  }

  public async cancel(requestId: string): Promise<void> {
    const owned = this.active.get(requestId);
    if (owned === undefined) return;
    owned.cancelled = true;
    await closeOwnedHarness(owned);
  }

  private createHarness(): ReasoningHarness {
    const harnessOptions: DeepSeekHarnessReasonerHarnessOptions = {
      profile: 'sdk-minimal',
      patches: [this.options.patchFile],
      cwd: this.options.processCwd,
      processCwd: this.options.processCwd,
      dshHome: this.options.dshHome,
      env: createSynthesisChildEnvironment(this.options.env),
      initializeTimeoutMs: Math.min(this.timeoutMs, 60_000),
      requestTimeoutMs: this.timeoutMs,
      ...(this.options.provider === undefined ? {} : { provider: this.options.provider }),
      ...(this.options.model === undefined ? {} : { model: this.options.model }),
    };
    return this.options.createHarness?.(harnessOptions)
      ?? new DeepSeekHarness(harnessOptions);
  }
}

function closeOwnedHarness(owned: OwnedReasoningHarness): Promise<void> {
  owned.closePromise ??= owned.harness.close();
  return owned.closePromise;
}

interface SubmissionCall {
  readonly callId: string;
  readonly argumentsText: string;
  readonly sequence: number;
}

interface SynthesisSubmission {
  readonly output: AgentJsonValue;
  readonly call: SubmissionCall;
  readonly resultSequence: number;
}

export function extractSynthesisSubmission(events: readonly unknown[]): SynthesisSubmission {
  return extractStructuredSubmission(events, SYNTHESIS_TOOL_NAME);
}

export function extractStructuredSubmission(
  events: readonly unknown[],
  submissionToolName: string,
): SynthesisSubmission {
  const calls = new Map<string, SubmissionCall>();
  const submissionCallIds = new Set<string>();
  const successful: SynthesisSubmission[] = [];

  for (const candidate of events) {
    const event = eventRecord(candidate);
    if (event === undefined) continue;
    if (event.type === 'tool/call') {
      const callId = stringField(event.data, 'callId');
      const name = stringField(event.data, 'name');
      const argumentsText = stringField(event.data, 'arguments');
      if (callId === undefined || name === undefined || argumentsText === undefined) {
        throw new InvalidSynthesisSubmissionError('Malformed tool/call event');
      }
      if (calls.has(callId)) {
        throw new InvalidSynthesisSubmissionError(`Duplicate tool call id: ${callId}`);
      }
      const call = { callId, argumentsText, sequence: event.sequence };
      calls.set(callId, call);
      if (name === submissionToolName) submissionCallIds.add(callId);
      continue;
    }
    if (event.type !== 'tool/result') continue;
    const message = recordField(event.data, 'message');
    const callId = stringField(message, 'toolCallId');
    if (callId === undefined) {
      throw new InvalidSynthesisSubmissionError('Malformed tool/result event');
    }
    const call = calls.get(callId);
    if (call === undefined) {
      throw new InvalidSynthesisSubmissionError(`Tool result has no matching call: ${callId}`);
    }
    if (!submissionCallIds.has(callId)) continue;
    if (message?.isError === true) {
      const error = recordField(event.data, 'error');
      const reason = stringField(error, 'reason') ?? 'unknown tool error';
      throw new InvalidSynthesisSubmissionError(`Synthesis submission tool failed: ${reason}`);
    }
    successful.push({
      output: parseJsonValue(call.argumentsText),
      call,
      resultSequence: event.sequence,
    });
  }

  for (const callId of submissionCallIds) {
    const hasResult = events.some((candidate) => {
      const event = eventRecord(candidate);
      return event?.type === 'tool/result'
        && stringField(recordField(event.data, 'message'), 'toolCallId') === callId;
    });
    if (!hasResult) {
      throw new InvalidSynthesisSubmissionError(`Submission call has no matching result: ${callId}`);
    }
  }
  if (successful.length !== 1) {
    throw new InvalidSynthesisSubmissionError(
      `Expected exactly one successful synthesis submission, received ${successful.length}`,
    );
  }
  return successful[0]!;
}

function mapSubmissionEvents(
  sessionId: string,
  submission: SynthesisSubmission,
  toolName: string,
): readonly AgentEvent[] {
  const occurredAt = new Date();
  return [
    {
      type: 'tool.started',
      eventId: `${sessionId}:${submission.call.sequence}`,
      sessionId,
      occurredAt,
      toolInvocationId: submission.call.callId,
      toolName,
    },
    {
      type: 'tool.completed',
      eventId: `${sessionId}:${submission.resultSequence}`,
      sessionId,
      occurredAt,
      toolInvocationId: submission.call.callId,
      toolName,
      success: true,
    },
  ];
}

interface EventRecord {
  readonly type: string;
  readonly sequence: number;
  readonly data: Readonly<Record<string, unknown>>;
}

function eventRecord(value: unknown): EventRecord | undefined {
  if (!isRecord(value) || typeof value.type !== 'string' || !isRecord(value.data)) return undefined;
  return {
    type: value.type,
    sequence: typeof value.seq === 'number' ? value.seq : 0,
    data: value.data,
  };
}

function parseJsonValue(value: string): AgentJsonValue {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error: unknown) {
    throw new InvalidSynthesisSubmissionError(
      `Submission arguments are not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isJsonValue(parsed)) {
    throw new InvalidSynthesisSubmissionError('Submission arguments are not a lossless JSON value');
  }
  return parsed;
}

function isJsonValue(value: unknown): value is AgentJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordField(
  record: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function stringField(
  record: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}
