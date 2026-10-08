import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { DeepSeekHarnessRuntimeFactory } from '@product-scout/agent/runtime-factory';
import {
  createDb,
  DrizzleProductEventStore,
  DrizzleResearchRunRepository,
} from '@product-scout/db';
import {
  DefaultAgentGateway,
  InMemoryLiveEventPublisher,
  type AgentGateway,
  type LiveEventPublisher,
  type ProductEventStore,
} from '@product-scout/research';

import type { ResearchRunRepository } from '@product-scout/db';

interface WebResearchDependencies {
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
  const runtimeFactory = new DeepSeekHarnessRuntimeFactory({
    processCwd: repoRoot,
    patchFile: resolve(repoRoot, 'apps/agent/src/dsh/cordis.patch.yml'),
    dshHome: process.env.DSH_HOME,
    provider: process.env.DSH_PROVIDER,
    model: process.env.DSH_MODEL,
    initializeTimeoutMs: readPositiveInteger(
      process.env.DSH_INITIALIZE_TIMEOUT_MS,
      60_000,
    ),
  });

  const gateway = new DefaultAgentGateway(runs, runtimeFactory, {
    eventStore,
    liveEventPublisher,
  });
  dependencies = { gateway, runs, eventStore, liveEventPublisher };
  return dependencies;
}

function resolveRepositoryRoot(): string {
  const configuredRoot = process.env.PRODUCT_SCOUT_ROOT;
  if (configuredRoot !== undefined && configuredRoot.trim() !== '') {
    return configuredRoot;
  }

  const cwd = process.cwd();
  const candidates = [cwd, resolve(cwd, '../..')];
  const root = candidates.find((candidate) =>
    existsSync(resolve(candidate, 'apps/agent/src/dsh/cordis.patch.yml')),
  );
  if (root === undefined) {
    throw new Error('Unable to locate the Product Scout repository root');
  }
  return root;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
