import { resolve } from 'node:path';

import type { AgentRuntimeReasoner } from '@product-scout/agent-sdk';

import {
  DeepSeekHarnessReasoner,
  type DeepSeekHarnessReasonerOptions,
} from '../synthesis/DeepSeekHarnessReasoner';
import {
  createResearchWorkflowRuntimeFactory,
  type ResearchWorkflowRuntimeDependencies,
} from './createAnalysisWorkflowRuntimeFactory';
import type { ResearchWorkflowRuntimeFactory } from '../runtime/ResearchWorkflowRuntimeFactory';

const OPPORTUNITY_TOOL_NAME = 'product_scout_submit_opportunities';
const REPORT_TOOL_NAME = 'product_scout_submit_report';
const VALIDATION_PLAN_TOOL_NAME = 'product_scout_submit_validation_plan';

export type ProductionResearchWorkflowDependencies = Omit<
  ResearchWorkflowRuntimeDependencies,
  'reasoner' | 'opportunityReasoner' | 'reportReasoner' | 'validationPlanReasoner'
>;

export interface ProductionResearchWorkflowOptions {
  readonly processCwd: string;
  readonly dshHome: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly provider?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly createReasoner?: (
    options: DeepSeekHarnessReasonerOptions,
  ) => AgentRuntimeReasoner;
}

/** Keeps all concrete DeepSeek Harness construction inside the Agent adapter package. */
export function createProductionResearchWorkflowRuntimeFactory(
  dependencies: ProductionResearchWorkflowDependencies,
  options: ProductionResearchWorkflowOptions,
): ResearchWorkflowRuntimeFactory {
  const createReasoner = options.createReasoner
    ?? ((reasonerOptions: DeepSeekHarnessReasonerOptions) =>
      new DeepSeekHarnessReasoner(reasonerOptions));
  const common = reasonerOptions(options);

  return createResearchWorkflowRuntimeFactory({
    ...dependencies,
    reasoner: createReasoner({
      ...common,
      patchFile: patch(options.processCwd, 'synthesis.patch.yml'),
    }),
    opportunityReasoner: createReasoner({
      ...common,
      patchFile: patch(options.processCwd, 'opportunities.patch.yml'),
      submissionToolName: OPPORTUNITY_TOOL_NAME,
    }),
    reportReasoner: createReasoner({
      ...common,
      patchFile: patch(options.processCwd, 'report.patch.yml'),
      submissionToolName: REPORT_TOOL_NAME,
    }),
    validationPlanReasoner: createReasoner({
      ...common,
      patchFile: patch(options.processCwd, 'validation-plan.patch.yml'),
      submissionToolName: VALIDATION_PLAN_TOOL_NAME,
    }),
  });
}

function reasonerOptions(
  options: ProductionResearchWorkflowOptions,
): Omit<DeepSeekHarnessReasonerOptions, 'patchFile' | 'submissionToolName'> {
  const processCwd = nonEmpty(options.processCwd, 'processCwd');
  const dshHome = nonEmpty(options.dshHome, 'dshHome');
  if (options.timeoutMs !== undefined
    && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0)) {
    throw new Error('timeoutMs must be a positive safe integer');
  }
  return {
    processCwd,
    dshHome,
    env: options.env,
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  };
}

function patch(processCwd: string, name: string): string {
  return resolve(processCwd, 'apps/agent/src/dsh', name);
}

function nonEmpty(value: string, name: string): string {
  if (value.trim() === '') throw new Error(`${name} must be a non-empty path`);
  return value;
}
