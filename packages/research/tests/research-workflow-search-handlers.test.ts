import { describe, expect, it } from 'vitest';
import {
  createEvidenceAcquisition,
  type AcquireEvidenceInput,
  type AcquireEvidenceResult,
  type Evidence,
  type EvidenceAcquisition,
  type EvidenceAcquisitionRepository,
  type EvidenceAcquisitionScope,
} from '@product-scout/evidence';

import {
  DEFAULT_RESEARCH_WORKFLOW_DEFINITION,
  InMemoryResearchWorkflowCoordinator,
  SearchResultEvidenceAcquisitionIngestion,
  ResearchWorkflowSearchHandlers,
  SearchTool,
  type ResearchWorkflowDefinition,
  type SearchResultItem,
} from '../src';

class MemoryEvidenceAcquisitionRepository implements EvidenceAcquisitionRepository {
  public readonly values: Evidence[] = [];
  public readonly acquisitions: EvidenceAcquisition[] = [];

  public async acquire(input: AcquireEvidenceInput): Promise<AcquireEvidenceResult> {
    const existingAcquisition = await this.getByScope(input);
    if (existingAcquisition !== null) {
      const evidence = this.values.find((value) =>
        value.id === existingAcquisition.evidenceId);
      if (evidence === undefined) throw new Error('missing acquired evidence');
      return { status: 'existing', evidence, acquisition: existingAcquisition };
    }
    const evidence = this.values.find((value) => value.id === input.evidence.id)
      ?? input.evidence;
    if (!this.values.includes(evidence)) this.values.push(evidence);
    const acquisition = createEvidenceAcquisition({
      id: `acquisition-${this.acquisitions.length + 1}`,
      evidenceId: evidence.id,
      researchRunId: input.researchRunId,
      workflowInvocationKey: input.workflowInvocationKey,
      stepId: input.stepId,
      sourceFingerprint: input.sourceFingerprint,
      capturedAt: input.capturedAt,
    });
    this.acquisitions.push(acquisition);
    return { status: 'created', evidence, acquisition };
  }

  public async getByScope(scope: EvidenceAcquisitionScope): Promise<EvidenceAcquisition | null> {
    return this.acquisitions.find((value) =>
      value.researchRunId === scope.researchRunId
      && value.workflowInvocationKey === scope.workflowInvocationKey
      && value.stepId === scope.stepId
      && value.sourceFingerprint === scope.sourceFingerprint) ?? null;
  }

  public async listByResearchRunId(researchRunId: string): Promise<readonly EvidenceAcquisition[]> {
    return this.acquisitions.filter((value) => value.researchRunId === researchRunId);
  }

  public async isAssociatedWithResearchRun(
    researchRunId: string,
    evidenceId: string,
  ): Promise<boolean> {
    return this.acquisitions.some((value) =>
      value.researchRunId === researchRunId && value.evidenceId === evidenceId);
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
  repository: MemoryEvidenceAcquisitionRepository,
) {
  const search = new SearchTool({
    search: async (query) => ({ query: query.query, items }),
  });
  let nextId = 0;
  return new ResearchWorkflowSearchHandlers({
    search,
    ingestion: new SearchResultEvidenceAcquisitionIngestion(repository, {
      idGenerator: {
        generate: () => `evidence-${++nextId}`,
      },
      now: () => new Date('2026-10-25T00:00:00.000Z'),
    }),
    sessionId: 'session-search-test',
  });
}

describe('ResearchWorkflowSearchHandlers', () => {
  it('forwards tool and persisted Evidence events through an awaited observer', async () => {
    const repository = new MemoryEvidenceAcquisitionRepository();
    const handlers = createHandlers([{ title: 'Original', url: 'https://example.test', snippet: 'Original excerpt' }], repository);
    const coordinator = new InMemoryResearchWorkflowCoordinator({ definition, handlers: handlers.handlers });
    const types: string[] = [];
    await coordinator.run({ researchRunId: 'observed', goal: 'Test' }, {
      onStepTransition: async () => {},
      onEvent: async (event) => {
        if (event.type === 'evidence.created') expect(repository.values.some((item) => item.id === event.evidenceId)).toBe(true);
        types.push(event.type);
      },
    });
    expect(types).toEqual(Array.from({ length: 4 }).flatMap(() => ['tool.started', 'tool.completed', 'evidence.created']));
  });
  it('passes ResearchRun context through SearchTool and returns persisted evidence ids', async () => {
    const repository = new MemoryEvidenceAcquisitionRepository();
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
    expect(repository.acquisitions).toHaveLength(4);
    expect(execution.steps[0]?.stepId).toBe('market_understanding');
  });

  it('keeps partial persistence as a completed step with diagnostics', async () => {
    const repository = new MemoryEvidenceAcquisitionRepository();
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
        ingestion: new SearchResultEvidenceAcquisitionIngestion(repository, {
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
    const repository = new MemoryEvidenceAcquisitionRepository();
    const search = new SearchTool({
      search: async () => ({
        query: 'failure',
        items: [{ title: '', url: 'https://example.test/invalid', snippet: 'invalid' }],
      }),
    });
    const handlers = new ResearchWorkflowSearchHandlers({
      search,
      ingestion: new SearchResultEvidenceAcquisitionIngestion(repository, {
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
    const repository = new MemoryEvidenceAcquisitionRepository();
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

  it('reuses the first Evidence when the same acquisition scope is replayed', async () => {
    const repository = new MemoryEvidenceAcquisitionRepository();
    const handlers = createHandlers([{
      title: 'Stable result',
      url: 'https://example.test/stable?b=2&a=1#section',
      snippet: 'Stable excerpt.',
    }], repository);
    const handler = handlers.handlers.get('market_understanding');
    if (handler === undefined) throw new Error('missing market handler');
    const input = {
      workflow: {
        researchRunId: 'run-replay',
        goal: 'workflow automation',
        idempotencyKey: 'invocation-replay',
      },
      definition: definition.steps[0]!,
      attempt: 1,
      completedSteps: new Map(),
      isCancelled: () => false,
    };

    const first = await handler(input);
    const replay = await handler(input);

    expect(first.status).toBe('completed');
    expect(replay).toMatchObject(first);
    expect(repository.values).toHaveLength(1);
    expect(repository.acquisitions).toHaveLength(1);
  });
});
