import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { createSearchTool } from '@product-scout/agent/search';
import {
  createProductionResearchWorkflowRuntimeFactory,
  type ProductionResearchWorkflowDependencies,
  type ProductionResearchWorkflowOptions,
} from '@product-scout/agent/workflow';
import type { AgentRuntimeFactory } from '@product-scout/agent-sdk';
import { readSearchConfig } from '@product-scout/config/search';
import {
  createDb,
  DrizzleClaimRepository,
  DrizzleEvidenceAcquisitionRepository,
  DrizzleEvidenceStoreRepository,
  DrizzleOpportunityRepository,
  DrizzleProductEventStore,
  DrizzleResearchFindingRepository,
  DrizzleResearchReportRepository,
  DrizzleResearchRunRepository,
  DrizzleValidationPlanRepository,
  type Database,
} from '@product-scout/db';
import {
  DefaultAgentGateway,
  InMemoryLiveEventPublisher,
  type AgentGateway,
  type LiveEventPublisher,
  type ProductEventStore,
  type SearchExecutor,
} from '@product-scout/research';

import type { ResearchRunRepository } from '@product-scout/db';

export interface WebResearchDependencies {
  readonly gateway: AgentGateway;
  readonly runs: ResearchRunRepository;
  readonly eventStore: ProductEventStore;
  readonly liveEventPublisher: LiveEventPublisher;
}

let dependencies: WebResearchDependencies | undefined;

export function getAgentGateway(): AgentGateway {
  return getDependencies().gateway;
}

export function getResearchEventDependencies(): Omit<WebResearchDependencies, 'gateway'> {
  const { runs, eventStore, liveEventPublisher } = getDependencies();
  return { runs, eventStore, liveEventPublisher };
}

function getDependencies(): WebResearchDependencies {
  if (dependencies !== undefined) {
    return dependencies;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    throw new Error('DATABASE_URL is required to create the Agent Gateway');
  }

  const repoRoot = resolveRepositoryRoot();
  const { db } = createDb(databaseUrl);
  const runs = new DrizzleResearchRunRepository(db);
  const eventStore = new DrizzleProductEventStore(db);
  const liveEventPublisher = new InMemoryLiveEventPublisher();
  const runtimeFactory = createProductionRuntimeFactory(db, repoRoot, process.env);

  const gateway = new DefaultAgentGateway(runs, runtimeFactory, {
    eventStore,
    liveEventPublisher,
  });
  dependencies = { gateway, runs, eventStore, liveEventPublisher };
  return dependencies;
}

interface ProductionRuntimeFactoryOverrides {
  readonly createSearch?: () => SearchExecutor;
  readonly createWorkflowFactory?: (
    dependencies: ProductionResearchWorkflowDependencies,
    options: ProductionResearchWorkflowOptions,
  ) => AgentRuntimeFactory;
}

/** Production composition root. Tests may replace transports without replacing ports. */
export function createProductionRuntimeFactory(
  db: Database,
  repoRoot: string,
  env: Readonly<Record<string, string | undefined>>,
  overrides: ProductionRuntimeFactoryOverrides = {},
): AgentRuntimeFactory {
  const maxSources = readPositiveInteger(env.AGENT_MAX_SOURCES, 100, 'AGENT_MAX_SOURCES');
  const maxSearches = readPositiveInteger(env.AGENT_MAX_SEARCHES, 30, 'AGENT_MAX_SEARCHES');
  const maxRounds = readPositiveInteger(env.AGENT_MAX_ROUNDS, 3, 'AGENT_MAX_ROUNDS');
  if (maxSources < 4) {
    throw new Error('AGENT_MAX_SOURCES must be at least 4 for the four research steps');
  }
  if (maxSearches < 4) {
    throw new Error('AGENT_MAX_SEARCHES must be at least 4 for the fixed research workflow');
  }
  if (maxRounds < 1) {
    throw new Error('AGENT_MAX_ROUNDS must be at least 1');
  }
  const timeoutMs = readPositiveInteger(env.AGENT_TIMEOUT_MS, 300_000, 'AGENT_TIMEOUT_MS');
  const dshHome = requiredEnvironmentValue(env.DSH_HOME, 'DSH_HOME');
  const provider = optionalEnvironmentValue(env.DSH_PROVIDER);
  const model = optionalEnvironmentValue(env.DSH_MODEL);
  const createWorkflowFactory = overrides.createWorkflowFactory
    ?? createProductionResearchWorkflowRuntimeFactory;

  return createWorkflowFactory({
    search: overrides.createSearch?.() ?? createSearchTool(readSearchConfig(env)),
    evidenceRepository: new DrizzleEvidenceStoreRepository(db),
    evidenceAcquisitionRepository: new DrizzleEvidenceAcquisitionRepository(db),
    claimRepository: new DrizzleClaimRepository(db),
    findingRepository: new DrizzleResearchFindingRepository(db),
    opportunityStore: new DrizzleOpportunityRepository(db),
    reportStore: new DrizzleResearchReportRepository(db),
    validationPlanStore: new DrizzleValidationPlanRepository(db),
    searchLimit: Math.min(100, Math.floor(maxSources / 4)),
    workflowTimeoutMs: timeoutMs,
  }, {
    processCwd: repoRoot,
    dshHome: resolve(repoRoot, dshHome),
    env,
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    timeoutMs,
  });
}

function resolveRepositoryRoot(): string {
  const configuredRoot = process.env.PRODUCT_SCOUT_ROOT;
  if (configuredRoot !== undefined && configuredRoot.trim() !== '') {
    return configuredRoot;
  }

  const cwd = process.cwd();
  const candidates = [cwd, resolve(cwd, '../..')];
  const root = candidates.find((candidate) =>
    existsSync(resolve(candidate, 'apps/agent/src/dsh/synthesis.patch.yml')),
  );
  if (root === undefined) {
    throw new Error('Unable to locate the Product Scout repository root');
  }
  return root;
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`${name} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
}

function requiredEnvironmentValue(value: string | undefined, name: string): string {
  const normalized = optionalEnvironmentValue(value);
  if (normalized === undefined) throw new Error(`${name} is required`);
  return normalized;
}

function optionalEnvironmentValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === '' ? undefined : normalized;
}
