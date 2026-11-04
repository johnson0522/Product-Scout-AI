import { describe, expect, it } from 'vitest';
import type { Evidence, EvidenceRepository } from '@product-scout/evidence';

import {
  DEFAULT_RESEARCH_WORKFLOW_DEFINITION,
  InMemoryResearchWorkflowCoordinator,
  SearchResultEvidenceIngestion,
  ResearchWorkflowSearchHandlers,
  SearchTool,
  type ResearchWorkflowDefinition,
  type SearchResultItem,
} from '../src';

class MemoryEvidenceRepository implements EvidenceRepository {
  public readonly values: Evidence[] = [];

  public async create(evidence: Evidence): Promise<void> {
    this.values.push(evidence);
  }

  public async getById(id: string): Promise<Evidence | null> {
    return this.values.find((value) => value.id === id) ?? null;
  }
}

const definition: ResearchWorkflowDefinition = {
  id: 'search-evidence-test',
  steps: [
    { id: 'market_understanding', dependsOn: [], allowSkip: false, maxAttempts: 1 },
    { id: 'pain_point_research', dependsOn: ['market_understanding'], allowSkip: false, maxAttempts: 1 },
    { id: 'competitor_research', dependsOn: ['market_understanding'], allowSkip: false, maxAttempts: 1 },
    { id: 'market_signal_research', dependsOn: ['market_understanding'], allowSkip: false, maxAttempts: 1 },
  ],
};

function createHandlers(
  items: readonly SearchResultItem[],
  repository: MemoryEvidenceRepository,
) {
  const search = new SearchTool({
    search: async (query) => ({ query: query.query, items }),
  });
  let nextId = 0;
  return new ResearchWorkflowSearchHandlers({
    search,
    ingestion: new SearchResultEvidenceIngestion(repository, {
      idGenerator: {
        generate: () => `evidence-${++nextId}`,
      },
      now: () => new Date('2026-10-25T00:00:00.000Z'),
    }),
    sessionId: 'session-search-test',
  });
}

describe('ResearchWorkflowSearchHandlers', () => {
  it('passes ResearchRun context through SearchTool and returns persisted evidence ids', async () => {
    const repository = new MemoryEvidenceRepository();
    const handlers = createHandlers([{
      title: 'Market result',
      url: 'https://example.test/market',
      snippet: 'A market signal.',
    }], repository);
    const coordinator = new InMemoryResearchWorkflowCoordinator({
      definition,
      handlers: handlers.handlers,
    });

    const execution = await coordinator.run({
      researchRunId: 'run-search-1',
      goal: 'workflow automation',
    });

    expect(execution.status).toBe('completed');
    expect(execution.steps[0]?.status).toBe('completed');
    expect(repository.values).toHaveLength(4);
    expect(execution.steps[0]?.stepId).toBe('market_understanding');
  });

  it('keeps partial persistence as a completed step with diagnostics', async () => {
    const repository = new MemoryEvidenceRepository();
    const search = new SearchTool({
      search: async (query) => ({
        query: query.query,
        items: [
          { title: 'Valid', url: 'https://example.test/valid', snippet: 'valid' },
          { title: '', url: 'https://example.test/invalid', snippet: 'invalid' },
        ],
      }),
    });
    const handlers = new ResearchWorkflowSearchHandlers({
      search,
        ingestion: new SearchResultEvidenceIngestion(repository, {
        idGenerator: { generate: () => 'evidence-partial' },
      }),
    });

    const result = await handlers.handlers.get('market_understanding')?.({
      workflow: { researchRunId: 'run-partial', goal: 'workflow automation' },
      definition: definition.steps[0]!,
      attempt: 1,
      completedSteps: new Map(),
      isCancelled: () => false,
    });

    expect(result).toMatchObject({
      status: 'completed',
      stepId: 'market_understanding',
      artifactIds: ['evidence-partial'],
      diagnostics: [{ code: 'evidence.mapping_failed' }],
    });
  });

  it('fails a step when search cannot produce any persisted evidence', async () => {
    const repository = new MemoryEvidenceRepository();
    const search = new SearchTool({
      search: async () => ({
        query: 'failure',
        items: [{ title: '', url: 'https://example.test/invalid', snippet: 'invalid' }],
      }),
    });
    const handlers = new ResearchWorkflowSearchHandlers({
      search,
      ingestion: new SearchResultEvidenceIngestion(repository, {
        idGenerator: { generate: () => 'unused' },
      }),
    });

    const result = await handlers.handlers.get('market_understanding')?.({
      workflow: { researchRunId: 'run-failure', goal: 'workflow automation' },
      definition: definition.steps[0]!,
      attempt: 1,
      completedSteps: new Map(),
      isCancelled: () => false,
    });

    expect(result).toMatchObject({
      status: 'failed',
      stepId: 'market_understanding',
      failure: { kind: 'execution_failed' },
    });
  });

  it('stops the default workflow at the explicitly unimplemented analysis boundary', async () => {
    const repository = new MemoryEvidenceRepository();
    const handlers = createHandlers([{
      title: 'Research result',
      url: 'https://example.test/result',
      snippet: 'A result.',
    }], repository);
    const coordinator = new InMemoryResearchWorkflowCoordinator({
      definition: DEFAULT_RESEARCH_WORKFLOW_DEFINITION,
      handlers: handlers.handlers,
    });

    const execution = await coordinator.run({
      researchRunId: 'run-default-boundary',
      goal: 'workflow automation',
    });

    expect(execution.status).toBe('failed');
    expect(execution.steps.find((step) => step.stepId === 'opportunity_analysis'))
      .toMatchObject({ status: 'failed', failure: { kind: 'precondition_failed' } });
    expect(execution.steps.find((step) => step.stepId === 'report_generation')?.status)
      .toBe('skipped');
  });
});
