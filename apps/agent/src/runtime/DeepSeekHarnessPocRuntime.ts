import { randomUUID } from 'node:crypto';
import { DeepSeekHarness, type HarnessNotification } from '@deepseek-ai/dsh-sdk-client';
import type {
  AgentEvent,
  AgentRunInput,
  AgentRunResult,
  AgentRuntime,
  AgentSession,
  AgentSessionId,
  AgentTrajectory,
  CreateSessionInput,
  ToolCompletedEvent,
  ToolStartedEvent,
} from '@product-scout/agent-sdk';

export interface DeepSeekHarnessPocRuntimeOptions {
  readonly processCwd: string;
  readonly patchFile: string;
  readonly dshHome?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly initializeTimeoutMs?: number;
}

interface SessionState {
  readonly input: CreateSessionInput;
  readonly createdAt: Date;
  readonly events: AgentEvent[];
  status: AgentSession['status'];
}

interface DshEventEnvelope {
  readonly type: string;
  readonly seq?: number;
  readonly data?: Readonly<Record<string, unknown>>;
}

/**
 * Minimal boundary proof for the public DSH TypeScript SDK.
 * It intentionally implements only the behavior exercised by the PoC.
 */
export class DeepSeekHarnessPocRuntime implements AgentRuntime {
  private readonly harness: DeepSeekHarness;
  private readonly sessions = new Map<AgentSessionId, SessionState>();
  private readonly toolNamesByCallId = new Map<string, string>();
  private response = '';

  constructor(options: DeepSeekHarnessPocRuntimeOptions) {
    this.harness = new DeepSeekHarness({
      profile: 'sdk-minimal',
      patches: [options.patchFile],
      cwd: options.processCwd,
      processCwd: options.processCwd,
      ...(options.dshHome === undefined ? {} : { dshHome: options.dshHome }),
      ...(options.provider === undefined ? {} : { provider: options.provider }),
      ...(options.model === undefined ? {} : { model: options.model }),
      initializeTimeoutMs: options.initializeTimeoutMs ?? 60000,
    });
  }

  get lastResponse(): string {
    return this.response;
  }

  async createSession(input: CreateSessionInput): Promise<AgentSession> {
    const id = `product-scout-${randomUUID().replaceAll('-', '')}`;
    const createdAt = new Date();
    this.sessions.set(id, { input, createdAt, events: [], status: 'created' });
    return { id, projectId: input.projectId, researchRunId: input.researchRunId, status: 'created', createdAt };
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const state = this.requireSession(input.sessionId);
    state.status = 'running';
    state.events.push({
      type: 'agent.started',
      eventId: randomUUID(),
      sessionId: input.sessionId,
      researchRunId: state.input.researchRunId,
      occurredAt: new Date(),
    });

    let runtimeFailure: string | undefined;
    try {
      const result = await this.harness.run(state.input.goal, {
        sessionId: input.sessionId,
        onNotification: (notification) => {
          runtimeFailure ??= readTurnFailure(input.sessionId, notification);
          const event = this.mapNotification(input.sessionId, notification);
          if (event !== undefined) state.events.push(event);
        },
      });
      if (runtimeFailure !== undefined) throw new Error(runtimeFailure);
      this.response = result.finalResponse;
      state.status = 'completed';
      state.events.push({
        type: 'agent.completed',
        eventId: randomUUID(),
        sessionId: input.sessionId,
        researchRunId: state.input.researchRunId,
        occurredAt: new Date(),
      });
      return { sessionId: input.sessionId, status: 'completed', trajectory: this.trajectory(input.sessionId, state) };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      state.status = 'failed';
      state.events.push({
        type: 'agent.failed',
        eventId: randomUUID(),
        sessionId: input.sessionId,
        researchRunId: state.input.researchRunId,
        occurredAt: new Date(),
        errorMessage,
        recoverable: false,
      });
      return { sessionId: input.sessionId, status: 'failed', trajectory: this.trajectory(input.sessionId, state) };
    }
  }

  async resume(_sessionId: AgentSessionId): Promise<AgentRunResult> {
    throw new Error('DSH SDK 0.2.1-alpha.1 has no resume request; resume needs a new explicit prompt.');
  }

  async cancel(sessionId: AgentSessionId): Promise<void> {
    const state = this.requireSession(sessionId);
    await this.harness.close();
    state.status = 'cancelled';
  }

  async getTrajectory(sessionId: AgentSessionId): Promise<AgentTrajectory> {
    return this.trajectory(sessionId, this.requireSession(sessionId));
  }

  async close(): Promise<void> {
    await this.harness.close();
  }

  private requireSession(sessionId: AgentSessionId): SessionState {
    const state = this.sessions.get(sessionId);
    if (state === undefined) throw new Error(`Unknown agent session: ${sessionId}`);
    return state;
  }

  private trajectory(sessionId: AgentSessionId, state: SessionState): AgentTrajectory {
    return { sessionId, events: [...state.events] };
  }

  private mapNotification(sessionId: AgentSessionId, notification: HarnessNotification): AgentEvent | undefined {
    if (notification.method !== 'session.event' || notification.params.sessionId !== sessionId) return undefined;
    const envelope = parseEventEnvelope(notification.params.event);
    if (envelope === undefined) return undefined;

    if (envelope.type === 'tool/call') return this.mapToolStarted(sessionId, envelope);
    if (envelope.type === 'tool/result') return this.mapToolCompleted(sessionId, envelope);
    return undefined;
  }

  private mapToolStarted(sessionId: AgentSessionId, event: DshEventEnvelope): ToolStartedEvent | undefined {
    const callId = readString(event.data, 'callId');
    const toolName = readString(event.data, 'name');
    if (callId === undefined || toolName === undefined) return undefined;
    this.toolNamesByCallId.set(callId, toolName);
    return {
      type: 'tool.started',
      eventId: eventId(sessionId, event),
      sessionId,
      occurredAt: new Date(),
      toolInvocationId: callId,
      toolName,
    };
  }

  private mapToolCompleted(sessionId: AgentSessionId, event: DshEventEnvelope): ToolCompletedEvent | undefined {
    const message = readRecord(event.data, 'message');
    const callId = readString(message, 'toolCallId');
    if (callId === undefined) return undefined;
    const error = readRecord(event.data, 'error');
    const errorMessage = readString(error, 'reason');
    return {
      type: 'tool.completed',
      eventId: eventId(sessionId, event),
      sessionId,
      occurredAt: new Date(),
      toolInvocationId: callId,
      toolName: this.toolNamesByCallId.get(callId) ?? 'unknown',
      success: message?.isError !== true,
      ...(errorMessage === undefined ? {} : { errorMessage }),
    };
  }
}

function parseEventEnvelope(value: unknown): DshEventEnvelope | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined;
  return {
    type: value.type,
    ...(typeof value.seq === 'number' ? { seq: value.seq } : {}),
    ...(isRecord(value.data) ? { data: value.data } : {}),
  };
}

function eventId(sessionId: AgentSessionId, event: DshEventEnvelope): string {
  return event.seq === undefined ? randomUUID() : `${sessionId}:${event.seq}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecord(
  record: Readonly<Record<string, unknown>> | undefined,
  key: string,
): Readonly<Record<string, unknown>> | undefined {
  const value = record?.[key];
  return isRecord(value) ? value : undefined;
}

function readString(record: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}

function readTurnFailure(sessionId: AgentSessionId, notification: HarnessNotification): string | undefined {
  if (notification.method !== 'session.event' || notification.params.sessionId !== sessionId) return undefined;
  const event = parseEventEnvelope(notification.params.event);
  if (event?.type !== 'turn/end') return undefined;
  const reason = readRecord(event.data, 'reason');
  if (readString(reason, 'kind') !== 'error') return undefined;
  const error = readRecord(reason, 'error');
  return readString(error, 'message') ?? 'DeepSeek Harness ended the turn with an unknown error.';
}
