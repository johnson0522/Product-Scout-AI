import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AgentRuntimeFactory } from '@product-scout/agent-sdk';
import { FakeRuntimeFactory } from '@product-scout/agent-sdk/testing';
import type { Database } from '@product-scout/db';
import type {
  ProductionResearchWorkflowDependencies,
  ProductionResearchWorkflowOptions,
} from '@product-scout/agent/workflow';

import { createProductionRuntimeFactory } from '../lib/agent-gateway';

describe('production Agent Gateway composition', () => {
  it('wires concrete repositories and bounded runtime configuration', () => {
    let capturedDependencies: ProductionResearchWorkflowDependencies | undefined;
    let capturedOptions: ProductionResearchWorkflowOptions | undefined;
    const expected = new FakeRuntimeFactory();
    const result = createProductionRuntimeFactory(
      Object.create(null) as Database,
      'D:/product-scout',
      {
        DSH_HOME: '.dsh-test',
        DSH_PROVIDER: 'deepseek',
        DSH_MODEL: 'deepseek-chat',
        AGENT_MAX_SEARCHES: '30',
        AGENT_MAX_SOURCES: '100',
        AGENT_MAX_ROUNDS: '3',
        AGENT_TIMEOUT_MS: '300000',
      },
      {
        createSearch: () => ({
          async execute(input) { return { query: input.query, items: [] }; },
        }),
        createWorkflowFactory: (dependencies, options): AgentRuntimeFactory => {
          capturedDependencies = dependencies;
          capturedOptions = options;
          return expected;
        },
      },
    );

    expect(result).toBe(expected);
    expect(capturedDependencies).toMatchObject({
      searchLimit: 5,
      workflowTimeoutMs: 300_000,
    });
    expect(capturedDependencies?.evidenceRepository.constructor.name)
      .toBe('DrizzleEvidenceStoreRepository');
    expect(capturedDependencies?.opportunityStore.constructor.name)
      .toBe('DrizzleOpportunityRepository');
    expect(capturedDependencies?.reportStore.constructor.name)
      .toBe('DrizzleResearchReportRepository');
    expect(capturedDependencies?.qualityStore.constructor.name)
      .toBe('DrizzleResearchQualitySnapshotRepository');
    expect(capturedDependencies?.validationPlanStore.constructor.name)
      .toBe('DrizzleValidationPlanRepository');
    expect(capturedOptions).toMatchObject({
      processCwd: 'D:/product-scout',
      provider: 'deepseek',
      model: 'deepseek-chat',
      timeoutMs: 300_000,
    });
    expect(capturedOptions?.dshHome).toBe(resolve('D:/product-scout', '.dsh-test'));
  });

  it('fails explicitly for missing DSH state configuration or impossible budgets', () => {
    const create = (env: Readonly<Record<string, string | undefined>>) => createProductionRuntimeFactory(
      Object.create(null) as Database,
      'D:/product-scout',
      env,
      {
        createSearch: () => ({
          async execute(input) { return { query: input.query, items: [] }; },
        }),
        createWorkflowFactory: () => new FakeRuntimeFactory(),
      },
    );
    expect(() => create({})).toThrow('DSH_HOME is required');
    expect(() => create({ DSH_HOME: '.dsh', AGENT_MAX_SEARCHES: '3' }))
      .toThrow('AGENT_MAX_SEARCHES must be at least 4');
    expect(() => create({ DSH_HOME: '.dsh', AGENT_TIMEOUT_MS: 'not-a-number' }))
      .toThrow('AGENT_TIMEOUT_MS must be a positive integer');
    expect(() => create({ DSH_HOME: '.dsh', AGENT_MAX_SEARCHES: '31' }))
      .toThrow('V0.1 budgets cannot exceed');
  });
});
