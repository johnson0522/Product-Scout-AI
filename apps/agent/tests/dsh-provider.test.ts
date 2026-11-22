import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { selectDshProvider } from '../src/synthesis/provider';
import {
  AgentReasoningRuntimeError, createSynthesisChildEnvironment, DeepSeekHarnessReasoner,
} from '../src/synthesis/DeepSeekHarnessReasoner';
import type { DeepSeekHarnessReasonerHarnessOptions } from '../src/synthesis/DeepSeekHarnessReasoner';

describe('DSH Provider selection', () => {
  it('retains the existing default route without requiring a Yunqiao key', () => {
    expect(selectDshProvider('/repo', {})).toEqual({ patches: [] });
    expect(selectDshProvider('/repo', {}, 'deepseek-official', 'existing-model'))
      .toEqual({ patches: [], provider: 'deepseek-official', model: 'existing-model' });
  });

  it('selects only the validated Yunqiao model and the same-version official plugin patch', () => {
    const selection = selectDshProvider('/repo', { LLM_API_KEY: 'secret' }, 'yunqiao');
    expect(selection).toEqual({
      provider: 'yunqiao', model: 'gpt-6.1-sol',
      patches: [resolve('/repo', 'apps/agent/src/dsh/yunqiao-responses.patch.yml')],
    });
    for (const endpoint of ['https://api.yunqiao.me', 'https://api.yunqiao.me/v1/']) {
      expect(() => selectDshProvider('/repo', { LLM_API_KEY: 'secret', LLM_BASE_URL: endpoint }, 'yunqiao'))
        .not.toThrow();
    }
  });

  it('fails before launch on missing credentials, an unsupported model or an untrusted endpoint', () => {
    expect(() => selectDshProvider('/repo', {}, 'yunqiao')).toThrow('LLM_API_KEY');
    expect(() => selectDshProvider('/repo', { LLM_API_KEY: 'secret' }, 'yunqiao', 'other')).toThrow('supports only');
    for (const endpoint of [
      'http://api.yunqiao.me', 'https://other.example', 'https://user:secret@api.yunqiao.me',
      'https://api.yunqiao.me/v1?key=secret', 'https://api.yunqiao.me/#fragment',
      'https://api.yunqiao.me/other', 'not-a-url',
    ]) {
      expect(() => selectDshProvider('/repo', { LLM_API_KEY: 'secret', LLM_BASE_URL: endpoint }, 'yunqiao')).toThrow();
    }
  });

  it('forwards only the selected provider credential and excludes Product secrets and runtime injection', () => {
    const source = {
      PATH: 'bin', LLM_API_KEY: 'yunqiao-secret', DEEPSEEK_API_KEY: 'deepseek-secret',
      DATABASE_URL: 'private', SEARCH_API_KEY: 'private', NODE_OPTIONS: '--import=evil',
      PRODUCT_SCOUT_RUNTIME_ROOT: 'untrusted', LLM_BASE_URL: 'untrusted',
    };
    expect(createSynthesisChildEnvironment(source, 'yunqiao')).toEqual({
      NODE_ENV: 'production', PATH: 'bin', LLM_API_KEY: 'yunqiao-secret',
    });
    expect(createSynthesisChildEnvironment(source)).toEqual({
      NODE_ENV: 'production', PATH: 'bin', DEEPSEEK_API_KEY: 'deepseek-secret',
    });
  });
});

describe('DSH Runtime Provider wiring', () => {
  it('bounds the wait for idle even when the SDK run never settles', async () => {
    let closed = false;
    const reasoner = new DeepSeekHarnessReasoner({
      processCwd: '/repo', patchFile: '/tool.patch.yml', dshHome: '/test-home', env: {},
      timeoutMs: 10,
      createHarness: () => ({
        async run() { return new Promise<never>(() => undefined); },
        async close() { closed = true; },
      }),
    });
    await expect(reasoner.reason(request())).rejects.toMatchObject({ code: 'DSH_TIMEOUT' });
    expect(closed).toBe(true);
  });

  it.each([
    ['synthesis', 'product_scout_submit_synthesis'],
    ['opportunities', 'product_scout_submit_opportunities'],
    ['report', 'product_scout_submit_report'],
    ['validation-plan', 'product_scout_submit_validation_plan'],
  ])('combines the Provider with the %s contract and closes its runtime', async (patch, tool) => {
    let received: DeepSeekHarnessReasonerHarnessOptions | undefined;
    let closed = 0;
    const reasoner = new DeepSeekHarnessReasoner({
      processCwd: '/repo', patchFile: `/repo/${patch}.patch.yml`, dshHome: '/test-home',
      provider: 'yunqiao', env: { LLM_API_KEY: 'secret', DATABASE_URL: 'private' },
      submissionToolName: tool,
      createHarness(options) {
        received = options;
        return {
          async run() { return { sessionId: 'test', events: events(tool) }; },
          async close() { closed += 1; },
        };
      },
    });
    await expect(reasoner.reason(request())).resolves.toMatchObject({ output: { valid: true } });
    expect(received).toMatchObject({
      cwd: '/repo', processCwd: resolve('/repo', 'apps/agent/src/dsh'),
      patches: [resolve('/repo', 'apps/agent/src/dsh/yunqiao-responses.patch.yml'), `/repo/${patch}.patch.yml`],
      env: { LLM_API_KEY: 'secret' },
      provider: 'yunqiao', model: 'gpt-6.1-sol', requestTimeoutMs: 120_000,
    });
    expect(received?.env).not.toHaveProperty('DATABASE_URL');
    expect(closed).toBe(1);
  });

  it.each(['error', 'aborted', 'max-tokens', 'blocked'])('rejects %s even after a successful submission', async (kind) => {
    let closed = false;
    const reasoner = new DeepSeekHarnessReasoner({
      processCwd: '/repo', patchFile: '/tool.patch.yml', dshHome: '/test-home', env: {},
      createHarness: () => ({
        async run() {
          return {
            sessionId: 'test', events: [
              ...events('product_scout_submit_synthesis'),
              { type: 'turn/end', data: { reason: { kind, error: { code: 'AUTH', message: 'private' } } } },
            ],
          };
        },
        async close() { closed = true; },
      }),
    });
    await expect(reasoner.reason(request())).rejects.toBeInstanceOf(AgentReasoningRuntimeError);
    expect(closed).toBe(true);
  });

  it.each(['cwd', 'home'])('refuses a %s .env that would bypass the credential allowlist', async (layer) => {
    const fixture = mkdtempSync(join(tmpdir(), 'product-scout-provider-'));
    if (!resolve(fixture).startsWith(resolve(tmpdir(), 'product-scout-provider-'))) {
      throw new Error('Unexpected fixture cleanup path');
    }
    try {
      const launch = join(fixture, 'apps/agent/src/dsh');
      const home = join(fixture, 'runtime-home');
      mkdirSync(launch, { recursive: true });
      mkdirSync(home);
      writeFileSync(join(layer === 'cwd' ? launch : home, '.env'), 'DATABASE_URL=fixture-only\n');
      const reasoner = new DeepSeekHarnessReasoner({
        processCwd: fixture, dshHome: home, patchFile: 'unused', env: {},
        createHarness: () => { throw new Error('Must not launch'); },
      });
      await expect(reasoner.reason(request())).rejects.toThrow('must not contain a .env');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});

function request() {
  return { requestId: 'provider-test', outputContract: 'test.v1', prompt: 'test' };
}

function events(tool: string) {
  return [
    { type: 'tool/call', seq: 1, data: { callId: 'c1', name: tool, arguments: '{"valid":true}' } },
    { type: 'tool/result', seq: 2, data: { message: { toolCallId: 'c1', isError: false } } },
    { type: 'turn/end', seq: 3, data: { reason: { kind: 'completed' } } },
  ];
}
