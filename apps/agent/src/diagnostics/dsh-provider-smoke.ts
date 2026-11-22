import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { DeepSeekHarnessReasoner } from '../synthesis/DeepSeekHarnessReasoner';
import { YUNQIAO_MODEL, YUNQIAO_PROVIDER } from '../synthesis/provider';

const root = resolve(process.cwd(), '../..');
let streamChunks = 0;
let toolArgumentChunks = 0;
let toolCalls = 0;

try {
  // Keep diagnostic state isolated from production sessions. No PostgreSQL access.
  await mkdir(resolve(root, '.dsh-runtime'), { recursive: true });
  const dshHome = await mkdtemp(resolve(root, '.dsh-runtime/provider-smoke-'));
  const reasoner = new DeepSeekHarnessReasoner({
    processCwd: root, dshHome, env: process.env,
    provider: YUNQIAO_PROVIDER, model: YUNQIAO_MODEL,
    patchFile: resolve(root, 'apps/agent/src/dsh/provider-probe.patch.yml'),
    submissionToolName: 'product_scout_submit_provider_probe',
    timeoutMs: 120_000,
    createHarness(options) {
      const harness = new DeepSeekHarness(options);
      return {
        async run(prompt) {
          await harness.start();
          process.stdout.write('PASS: DSH initialize with yunqiao / gpt-6.1-sol\n');
          const result = await harness.run(prompt);
          // Read only metadata from public SDK events, never print reasoning/content.
          for (const event of result.events) {
            if (event.type === 'turn/end' && event.data.reason.kind === 'error') {
              const failure = event.data.reason.error;
              const message = failure.message.split(process.env.LLM_API_KEY ?? '\0').join('[REDACTED]').slice(0, 500);
              process.stderr.write(`${JSON.stringify({ code: failure.code, message })}\n`);
            }
            if (event.type === 'tool/call') toolCalls += 1;
            if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') continue;
            for (const record of event.data.stream) {
              if (record.type === 'text-chunks') streamChunks += record.texts.length;
              if (record.type === 'tool-call-chunks') toolArgumentChunks += record.dt.length;
            }
          }
          return result;
        },
        async close() { await harness.close(); },
      };
    },
  });
  const result = await reasoner.reason({
    requestId: 'provider-smoke', outputContract: 'provider-probe.v1',
    prompt: 'Connectivity test only. Call product_scout_provider_probe once with a=19, b=23. '
      + 'Read its result, then call product_scout_submit_provider_probe exactly once with the returned sum '
      + 'and exact receipt. After accepted=true, reply with PSC_DSH_OK and stop. Do not call other tools.',
  });
  if (toolCalls !== 2 || toolArgumentChunks === 0 || streamChunks === 0) {
    throw new Error('Expected two tool calls and streamed text/tool arguments in DSH events');
  }
  process.stdout.write(`${JSON.stringify({
    status: 'PASS', provider: YUNQIAO_PROVIDER, model: YUNQIAO_MODEL,
    toolCalls, streamChunks, toolArgumentChunks, productEvents: result.events.length,
    structuredResultValidated: true,
  })}\n`);

  // Also exercise an unchanged business submission schema through the actual
  // production adapter. Empty evidence explicitly yields an empty test plan;
  // no Claim/Finding is fabricated and nothing is persisted to PostgreSQL.
  const synthesis = new DeepSeekHarnessReasoner({
    processCwd: root, dshHome, env: process.env,
    provider: YUNQIAO_PROVIDER, model: YUNQIAO_MODEL,
    patchFile: resolve(root, 'apps/agent/src/dsh/synthesis.patch.yml'),
    timeoutMs: 120_000,
  });
  const submitted = await synthesis.reason({
    requestId: 'provider-synthesis-smoke', outputContract: 'research-synthesis-plan.v1',
    prompt: 'Schema connectivity test. There is no research input and no evidence. '
      + 'Do not invent claims, findings, or assessments. Call product_scout_submit_synthesis exactly once '
      + 'with claims=[], findings=[], assessments=[]. After accepted=true, reply PSC_SYNTHESIS_OK and stop.',
  });
  const value = submitted.output;
  if (value === null || Array.isArray(value) || typeof value !== 'object'
    || Object.keys(value).sort().join(',') !== 'assessments,claims,findings'
    || !Object.values(value).every((field: unknown) => Array.isArray(field) && field.length === 0)) {
    throw new Error('Expected the empty synthesis contract for the no-evidence test');
  }
  process.stdout.write('PASS: production synthesis submission schema through DSH / yunqiao\n');
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown DSH provider failure';
  const key = process.env.LLM_API_KEY;
  process.stderr.write(`FAIL: ${key ? message.split(key).join('[REDACTED]') : message}\n`);
  process.exitCode = 1;
}
