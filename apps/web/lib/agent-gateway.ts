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
  DrizzleProjectRepository,
  DrizzleProductEventStore,
  DrizzleResearchFindingRepository,
  DrizzleResearchQualitySnapshotRepository,
  DrizzleResearchReportRepository,
  DrizzleResearchRunRepository,
  DrizzleResearchStepRepository,
  DrizzleSourceRepository,
  DrizzleValidationPlanRepository,
  type Database,
} from '@product-scout/db';
import {
  DefaultAgentGateway,
  InMemoryLiveEventPublisher,
  HttpsWebFetcher,
  SourceResearchSearch,
  type AgentGateway,
  type LiveEventPublisher,
  type ProductEventStore,
  type SearchExecutor,
} from '@product-scout/research';

import type { ResearchRunRepository } from '@product-scout/db';
import { ProductApi } from './product-api';

export interface WebResearchDependencies {
  readonly gateway: AgentGateway;
  readonly runs: ResearchRunRepository;
  readonly eventStore: ProductEventStore;
  readonly liveEventPublisher: LiveEventPublisher;
}

let dependencies: WebResearchDependencies | undefined;
let database: Database | undefined;

function getDatabase(): Database {
  if (database !== undefined) return database;
  const url = process.env.DATABASE_URL;
  if (!url?.trim()) throw new Error('DATABASE_URL is required');
  database = createDb(url).db;
  return database;
}

export function getProductApi(): ProductApi {
  const db = getDatabase();
  const ownerId = process.env.PRODUCT_SCOUT_OWNER_ID;
  if (!ownerId) throw new Error('PRODUCT_SCOUT_OWNER_ID is required');
  return new ProductApi({
    projects: new DrizzleProjectRepository(db),
    runs: new DrizzleResearchRunRepository(db),
    acquisitions: new DrizzleEvidenceAcquisitionRepository(db),
    evidence: new DrizzleEvidenceStoreRepository(db),
    claims: new DrizzleClaimRepository(db),
    findings: new DrizzleResearchFindingRepository(db),
    quality: new DrizzleResearchQualitySnapshotRepository(db),
    opportunities: new DrizzleOpportunityRepository(db),
    reports: new DrizzleResearchReportRepository(db),
    validationPlans: new DrizzleValidationPlanRepository(db),
  }, ownerId);
}

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
  const db = getDatabase();
  const runs = new DrizzleResearchRunRepository(db);
  const eventStore = new DrizzleProductEventStore(db);
  const stepStore = new DrizzleResearchStepRepository(db);
  const liveEventPublisher = new InMemoryLiveEventPublisher();
  // Defer provider configuration until execution so reads/cancellation remain
  // available even when a model or Search provider is temporarily unconfigured.
  const runtimeFactory: AgentRuntimeFactory = {
    metadata: { runtime: 'research-workflow', workflow: 'product-scout-research-v0.1' },
    create: async () => createProductionRuntimeFactory(db, repoRoot, process.env).create(),
  };

  const gateway = new DefaultAgentGateway(runs, runtimeFactory, {
    eventStore,
    liveEventPublisher,
    stepStore,
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
  if (maxSources > 100 || maxSearches > 30 || maxRounds > 3) {
    throw new Error('V0.1 budgets cannot exceed 100 sources, 30 searches, or 3 rounds');
  }
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
    search: overrides.createSearch?.() ?? new SourceResearchSearch(
      createSearchTool(readSearchConfig(env)), new HttpsWebFetcher(), new DrizzleSourceRepository(db),
    ),
    evidenceRepository: new DrizzleEvidenceStoreRepository(db),
    evidenceAcquisitionRepository: new DrizzleEvidenceAcquisitionRepository(db),
    claimRepository: new DrizzleClaimRepository(db),
    findingRepository: new DrizzleResearchFindingRepository(db),
    qualityStore: new DrizzleResearchQualitySnapshotRepository(db),
    opportunityStore: new DrizzleOpportunityRepository(db),
    reportStore: new DrizzleResearchReportRepository(db),
    validationPlanStore: new DrizzleValidationPlanRepository(db),
    // Twenty 8k excerpts leave headroom under the synthesis 200k-character
    // envelope. MAX_SOURCES is an upper bound, never a collection target.
    searchLimit: Math.min(5, Math.floor(maxSources / 4)),
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
