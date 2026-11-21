import type {
  AgentEvent,
  AgentReasoningInput,
  AgentReasoningResult,
  AgentRunInput,
  AgentRunResult,
  AgentRuntime,
  AgentRuntimeFactory,
  AgentRuntimeReasoner,
  AgentSession,
  AgentSessionId,
  AgentTrajectory,
  CreateSessionInput,
} from './index';

export interface FakeReasonerOptions {
  readonly output?: AgentReasoningResult['output'];
  readonly events?: readonly AgentEvent[];
  readonly error?: Error;
  readonly gate?: Promise<void>;
}

/** Deterministic structured reasoner for application-layer tests. */
export class FakeReasoner implements AgentRuntimeReasoner {
  public readonly calls: {
    reason: AgentReasoningInput[];
    cancel: string[];
  } = { reason: [], cancel: [] };

  public constructor(private readonly options: FakeReasonerOptions = {}) {}

  public async reason(input: AgentReasoningInput): Promise<AgentReasoningResult> {
    this.calls.reason.push(input);
    await this.options.gate;
    if (this.options.error !== undefined) throw this.options.error;
    return {
      requestId: input.requestId,
      outputContract: input.outputContract,
      output: this.options.output ?? null,
      events: [...(this.options.events ?? [])],
    };
  }

  public async cancel(requestId: string): Promise<void> {
    this.calls.cancel.push(requestId);
  }
}

export interface FakeRuntimeOptions {
  readonly events?: readonly AgentEvent[];
  readonly resultStatus?: AgentRunResult['status'];
  readonly runError?: Error;
  readonly runGate?: Promise<void>;
  readonly sessionId?: AgentSessionId;
  readonly now?: () => Date;
}

interface FakeSessionState {
  readonly session: AgentSession;
  readonly events: AgentEvent[];
}

/** Deterministic runtime for gateway and product-layer tests. */
export class FakeRuntime implements AgentRuntime {
  private readonly sessions = new Map<AgentSessionId, FakeSessionState>();
  private readonly options: FakeRuntimeOptions;
  private nextSessionNumber = 1;

  public readonly calls: {
    createSession: CreateSessionInput[];
    run: AgentRunInput[];
    resume: AgentSessionId[];
    cancel: AgentSessionId[];
  } = { createSession: [], run: [], resume: [], cancel: [] };

  public constructor(options: FakeRuntimeOptions = {}) {
    this.options = options;
  }

  public async createSession(input: CreateSessionInput): Promise<AgentSession> {
    this.calls.createSession.push(input);
    const id = this.options.sessionId ?? `fake-session-${this.nextSessionNumber++}`;
    const session: AgentSession = {
      id,
      projectId: input.projectId,
      researchRunId: input.researchRunId,
      status: 'created',
      createdAt: this.now(),
    };
    this.sessions.set(id, { session, events: [...(this.options.events ?? [])] });
    return session;
  }

  public async run(input: AgentRunInput): Promise<AgentRunResult> {
    this.calls.run.push(input);
    const state = this.requireSession(input.sessionId);
    await this.options.runGate;
    if (this.options.runError !== undefined) {
      throw this.options.runError;
    }
    for (const event of state.events) {
      await input.onEvent?.(event);
    }
    return {
      sessionId: input.sessionId,
      status: this.options.resultStatus ?? 'completed',
      trajectory: { sessionId: input.sessionId, events: [...state.events] },
    };
  }

  public async resume(sessionId: AgentSessionId): Promise<AgentRunResult> {
    this.calls.resume.push(sessionId);
    return this.run({ sessionId });
  }

  public async cancel(sessionId: AgentSessionId): Promise<void> {
    this.requireSession(sessionId);
    this.calls.cancel.push(sessionId);
  }

  public async getTrajectory(sessionId: AgentSessionId): Promise<AgentTrajectory> {
    const state = this.requireSession(sessionId);
    return { sessionId, events: [...state.events] };
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private requireSession(sessionId: AgentSessionId): FakeSessionState {
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      throw new Error(`Unknown fake agent session: ${sessionId}`);
    }
    return state;
  }
}

export class FakeRuntimeFactory implements AgentRuntimeFactory {
  public readonly metadata = { runtime: 'fake' } as const;
  public readonly createdRuntimes: FakeRuntime[] = [];

  public constructor(private readonly options: FakeRuntimeOptions = {}) {}

  public async create(): Promise<FakeRuntime> {
    const runtime = new FakeRuntime(this.options);
    this.createdRuntimes.push(runtime);
    return runtime;
  }
}
