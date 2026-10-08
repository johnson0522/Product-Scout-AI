import type { AgentRuntime, AgentRuntimeFactory } from '@product-scout/agent-sdk';

import {
  DeepSeekHarnessPocRuntime,
  type DeepSeekHarnessPocRuntimeOptions,
} from './DeepSeekHarnessPocRuntime';

/**
 * Production composition boundary for the current DSH adapter.
 * Consumers depend only on AgentRuntimeFactory and never construct DSH directly.
 */
export class DeepSeekHarnessRuntimeFactory implements AgentRuntimeFactory {
  public readonly metadata = {
    runtime: 'deepseek-harness',
    adapter: 'DeepSeekHarnessPocRuntime',
    sdkVersion: '0.2.1-alpha.1',
  } as const;
  public constructor(
    private readonly options: DeepSeekHarnessPocRuntimeOptions,
    private readonly buildRuntime: (
      options: DeepSeekHarnessPocRuntimeOptions,
    ) => AgentRuntime = (runtimeOptions) =>
      new DeepSeekHarnessPocRuntime(runtimeOptions),
  ) {}

  public async create(): Promise<AgentRuntime> {
    return this.buildRuntime(this.options);
  }
}
