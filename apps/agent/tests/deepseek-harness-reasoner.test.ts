import { describe, expect, it } from 'vitest';

import {
  AgentReasoningCancelledError,
  createSynthesisChildEnvironment,
  DeepSeekHarnessReasoner,
  extractSynthesisSubmission,
  extractStructuredSubmission,
  InvalidSynthesisSubmissionError,
  type ReasoningHarness,
  type ReasoningHarnessResult,
} from '../src/synthesis/DeepSeekHarnessReasoner';

const plan = { claims: [], findings: [], assessments: [] } as const;

describe('extractSynthesisSubmission', () => {
  it('extracts arguments only from one paired successful submission', () => {
    expect(extractSynthesisSubmission(submissionEvents(JSON.stringify(plan))).output).toEqual(plan);
  });

  it('rejects absent, failed, duplicate, malformed, and unpaired submissions', () => {
    expect(() => extractSynthesisSubmission([])).toThrow('received 0');
    expect(() => extractSynthesisSubmission(submissionEvents('{}', true)))
      .toThrow('submission tool failed');
    expect(() => extractSynthesisSubmission([
      ...submissionEvents('{}', false, 'call-1'),
      ...submissionEvents('{}', false, 'call-2'),
    ])).toThrow('received 2');
    expect(() => extractSynthesisSubmission(submissionEvents('{')))
      .toThrow('not valid JSON');
    expect(() => extractSynthesisSubmission([submissionEvents('{}')[0]]))
      .toThrow('no matching result');
    expect(() => extractSynthesisSubmission([submissionEvents('{}')[1]]))
      .toThrow('no matching call');
  });
});

describe('extractStructuredSubmission', () => {
  it('selects only the configured submission tool', () => {
    const events = submissionEventsWithName('{"opportunities":[]}', 'product_scout_submit_opportunities');
    expect(extractStructuredSubmission(events, 'product_scout_submit_opportunities').output)
      .toEqual({ opportunities: [] });
    expect(() => extractStructuredSubmission(events, 'product_scout_submit_synthesis'))
      .toThrow('received 0');
  });

  it('rejects failed and multiple submissions for the configured tool', () => {
    const name = 'product_scout_submit_opportunities';
    expect(() => extractStructuredSubmission(
      submissionEventsWithName('{}', name, true),
      name,
    )).toThrow('submission tool failed');
    expect(() => extractStructuredSubmission([
      ...submissionEventsWithName('{}', name, false, 'opportunity-1'),
      ...submissionEventsWithName('{}', name, false, 'opportunity-2'),
    ], name)).toThrow('received 2');
  });
});

describe('DeepSeekHarnessReasoner', () => {
  it('passes bounded isolated options, ignores prose, and always closes', async () => {
    const harness = new StubHarness({ sessionId: 'session-1', events: submissionEvents(JSON.stringify(plan)) });
    let receivedOptions: unknown;
    const reasoner = new DeepSeekHarnessReasoner({
      processCwd: 'D:/repo',
      patchFile: 'D:/repo/synthesis.patch.yml',
      dshHome: 'D:/isolated-home',
      env: { DEEPSEEK_API_KEY: 'secret', DATABASE_URL: 'must-not-leak' },
      timeoutMs: 5_000,
      createHarness: (options) => {
        receivedOptions = options;
        return harness;
      },
    });

    await expect(reasoner.reason({
      requestId: 'request-1',
      outputContract: 'research-synthesis-plan.v1',
      prompt: 'prompt',
    })).resolves.toMatchObject({ output: plan });
    expect(receivedOptions).toMatchObject({
      patches: ['D:/repo/synthesis.patch.yml'],
      dshHome: 'D:/isolated-home',
      requestTimeoutMs: 5_000,
      env: { DEEPSEEK_API_KEY: 'secret' },
    });
    expect(harness.closed).toBe(1);
  });

  it('closes after extraction failures', async () => {
    const harness = new StubHarness({ sessionId: 'session-1', events: [] });
    const reasoner = createReasoner(harness);

    await expect(reasoner.reason(request())).rejects.toBeInstanceOf(InvalidSynthesisSubmissionError);
    expect(harness.closed).toBe(1);
  });

  it('cancels the active request by closing its owned runtime', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const harness = new StubHarness(
      { sessionId: 'session-1', events: submissionEvents(JSON.stringify(plan)) },
      gate,
      () => release?.(),
    );
    const reasoner = createReasoner(harness);
    const pending = reasoner.reason(request());
    const cancelled = expect(pending).rejects.toBeInstanceOf(AgentReasoningCancelledError);
    await Promise.resolve();

    await reasoner.cancel('request-1');
    await cancelled;

    expect(harness.closed).toBe(1);
  });

  it('allows only explicitly named child environment variables', () => {
    expect(createSynthesisChildEnvironment({
      PATH: 'bin',
      DEEPSEEK_API_KEY: 'key',
      DATABASE_URL: 'must-not-leak',
    })).toEqual({
      NODE_ENV: 'production',
      PATH: 'bin',
      DEEPSEEK_API_KEY: 'key',
    });
  });

  it('maps events using the configured submission tool name', async () => {
    const toolName = 'product_scout_submit_opportunities';
    const harness = new StubHarness({
      sessionId: 'session-1',
      events: submissionEventsWithName('{"opportunities":[]}', toolName),
    });
    const reasoner = new DeepSeekHarnessReasoner({
      processCwd: 'D:/repo',
      patchFile: 'D:/repo/opportunities.patch.yml',
      dshHome: 'D:/isolated-home',
      env: {},
      submissionToolName: toolName,
      createHarness: () => harness,
    });

    const result = await reasoner.reason(request());
    expect(result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolName }),
    ]));
  });
});

class StubHarness implements ReasoningHarness {
  public closed = 0;
  public constructor(
    private readonly result: ReasoningHarnessResult,
    private readonly gate: Promise<void> = Promise.resolve(),
    private readonly onClose?: () => void,
  ) {}
  public async run(): Promise<ReasoningHarnessResult> {
    await this.gate;
    return this.result;
  }
  public async close(): Promise<void> {
    this.closed += 1;
    this.onClose?.();
  }
}

function createReasoner(harness: ReasoningHarness): DeepSeekHarnessReasoner {
  return new DeepSeekHarnessReasoner({
    processCwd: 'D:/repo',
    patchFile: 'D:/repo/synthesis.patch.yml',
    dshHome: 'D:/isolated-home',
    env: {},
    createHarness: () => harness,
  });
}

function request() {
  return {
    requestId: 'request-1',
    outputContract: 'research-synthesis-plan.v1',
    prompt: 'prompt',
  } as const;
}

function submissionEvents(argumentsText: string, isError = false, callId = 'call-1') {
  return submissionEventsWithName(
    argumentsText,
    'product_scout_submit_synthesis',
    isError,
    callId,
  );
}

function submissionEventsWithName(
  argumentsText: string,
  name: string,
  isError = false,
  callId = 'call-1',
) {
  return [
    {
      type: 'tool/call',
      seq: 1,
      data: { callId, name, arguments: argumentsText },
    },
    {
      type: 'tool/result',
      seq: 2,
      data: { message: { toolCallId: callId, isError } },
    },
  ];
}
