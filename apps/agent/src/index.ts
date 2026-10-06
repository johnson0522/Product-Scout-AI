import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { CreateSessionInput } from '@product-scout/agent-sdk';
import { DeepSeekHarnessPocRuntime } from './runtime/DeepSeekHarnessPocRuntime';

export interface PocResult {
  readonly sessionId: string;
  readonly finalResponse: string;
  readonly toolCalls: readonly {
    readonly name: string;
    readonly succeeded: boolean;
  }[];
}

export async function runPoc(): Promise<PocResult> {
  const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
  const runtime = new DeepSeekHarnessPocRuntime({
    processCwd: repoRoot,
    dshHome: resolve(tmpdir(), 'product-scout-dsh-poc'),
    patchFile: resolve(repoRoot, 'apps/agent/src/dsh/cordis.patch.yml'),
    initializeTimeoutMs: 60000,
  });

  const input: CreateSessionInput = {
    projectId: 'poc-project',
    researchRunId: 'poc-research-run',
    goal: 'Call the product_scout_echo tool with value "Product Scout" and return its structured result.',
  };

  try {
    const session = await runtime.createSession(input);
    const result = await runtime.run({ sessionId: session.id });
    const toolCalls = result.trajectory.events.flatMap((event) =>
      event.type === 'tool.completed'
        ? [{ name: event.toolName, succeeded: event.success }]
        : [],
    );
    const echoCall = toolCalls.find((call) => call.name === 'product_scout_echo' && call.succeeded);
    if (result.status !== 'completed' || echoCall === undefined || runtime.lastResponse.trim() === '') {
      const failure = result.trajectory.events.find((event) => event.type === 'agent.failed');
      throw new Error(
        failure?.errorMessage
          ?? 'DSH PoC did not complete the required product_scout_echo tool call. Check DEEPSEEK_API_KEY and the selected model.',
      );
    }
    return { sessionId: session.id, finalResponse: runtime.lastResponse, toolCalls };
  } finally {
    await runtime.close();
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && resolve(entryPath) === resolve(fileURLToPath(import.meta.url))) {
  const result = await runPoc();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
