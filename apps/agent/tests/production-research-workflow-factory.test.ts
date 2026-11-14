import { describe, expect, it } from 'vitest';

import { FakeReasoner } from '@product-scout/agent-sdk/testing';

import {
  createProductionResearchWorkflowRuntimeFactory,
  type ProductionResearchWorkflowDependencies,
} from '../src/workflow';
import type { DeepSeekHarnessReasonerOptions } from '../src/synthesis';

describe('createProductionResearchWorkflowRuntimeFactory', () => {
  it('isolates each structured contract behind its dedicated DSH patch and Tool', () => {
    const received: DeepSeekHarnessReasonerOptions[] = [];
    const factory = createProductionResearchWorkflowRuntimeFactory(dependencies(), {
      processCwd: 'D:/product-scout',
      dshHome: 'D:/dsh-home',
      env: { DEEPSEEK_API_KEY: 'secret', DATABASE_URL: 'must-not-leak' },
      provider: 'deepseek',
      model: 'deepseek-chat',
      timeoutMs: 300_000,
      createReasoner: (options) => {
        received.push(options);
        return new FakeReasoner();
      },
    });

    expect(factory.metadata).toEqual({
      runtime: 'research-workflow',
      workflow: 'product-scout-research-v0.1',
      reasoner: 'agent-runtime-reasoner',
    });
    expect(received.map((options) => ({
      patchFile: options.patchFile.replaceAll('\\', '/'),
      submissionToolName: options.submissionToolName,
    }))).toEqual([
      {
        patchFile: 'D:/product-scout/apps/agent/src/dsh/synthesis.patch.yml',
        submissionToolName: undefined,
      },
      {
        patchFile: 'D:/product-scout/apps/agent/src/dsh/opportunities.patch.yml',
        submissionToolName: 'product_scout_submit_opportunities',
      },
      {
        patchFile: 'D:/product-scout/apps/agent/src/dsh/report.patch.yml',
        submissionToolName: 'product_scout_submit_report',
      },
      {
        patchFile: 'D:/product-scout/apps/agent/src/dsh/validation-plan.patch.yml',
        submissionToolName: 'product_scout_submit_validation_plan',
      },
    ]);
    expect(received.every((options) =>
      options.dshHome === 'D:/dsh-home' && options.timeoutMs === 300_000)).toBe(true);
  });

  it('rejects an implicit DSH state location', () => {
    expect(() => createProductionResearchWorkflowRuntimeFactory(dependencies(), {
      processCwd: 'D:/product-scout',
      dshHome: ' ',
      env: {},
      createReasoner: () => new FakeReasoner(),
    })).toThrow('dshHome must be a non-empty path');
  });
});

function dependencies(): ProductionResearchWorkflowDependencies {
  return {
    search: {
      async execute(input) { return { query: input.query, items: [] }; },
    },
    evidenceRepository: {
      async create() {},
      async getById() { return null; },
    },
    evidenceAcquisitionRepository: {
      async acquire() { throw new Error('not used'); },
      async findByScope() { return null; },
      async listByResearchRunId() { return []; },
    },
    claimRepository: {
      async create() {},
      async getById() { return null; },
      async listByResearchRunId() { return []; },
    },
    findingRepository: {
      async create() {},
      async getById() { return null; },
      async listByResearchRunId() { return []; },
    },
    opportunityStore: {
      async getById() { return null; },
      async ensure(opportunity) { return opportunity; },
    },
    reportStore: {
      async getById() { return null; },
      async ensure(report) { return report; },
    },
    validationPlanStore: {
      async getById() { return null; },
      async ensure(plan) { return plan; },
    },
  };
}
