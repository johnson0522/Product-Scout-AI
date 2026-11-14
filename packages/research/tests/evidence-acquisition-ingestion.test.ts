import { describe, expect, it } from 'vitest';
import {
  createEvidenceAcquisition,
  type AcquireEvidenceInput,
  type AcquireEvidenceResult,
  type EvidenceAcquisition,
  type EvidenceAcquisitionRepository,
  type EvidenceAcquisitionScope,
} from '@product-scout/evidence';

import {
  createEvidenceSourceFingerprint,
  normalizeEvidenceSourceUrl,
  SearchResultEvidenceAcquisitionIngestion,
  type EvidenceIdGenerator,
} from '../src';

class RecordingAcquisitionRepository implements EvidenceAcquisitionRepository {
  public readonly inputs: AcquireEvidenceInput[] = [];
  private acquisition: EvidenceAcquisition | undefined;
  private evidence: AcquireEvidenceInput['evidence'] | undefined;

  public async acquire(input: AcquireEvidenceInput): Promise<AcquireEvidenceResult> {
    this.inputs.push(input);
    if (this.acquisition !== undefined && this.evidence !== undefined) {
      return { status: 'existing', evidence: this.evidence, acquisition: this.acquisition };
    }
    this.evidence = input.evidence;
    this.acquisition = createEvidenceAcquisition({
      id: 'acquisition-1',
      evidenceId: input.evidence.id,
      researchRunId: input.researchRunId,
      workflowInvocationKey: input.workflowInvocationKey,
      stepId: input.stepId,
      sourceFingerprint: input.sourceFingerprint,
      capturedAt: input.capturedAt,
    });
    return { status: 'created', evidence: this.evidence, acquisition: this.acquisition };
  }

  public async getByScope(_scope: EvidenceAcquisitionScope): Promise<EvidenceAcquisition | null> {
    return this.acquisition ?? null;
  }

  public async listByResearchRunId(_researchRunId: string): Promise<readonly EvidenceAcquisition[]> {
    return this.acquisition === undefined ? [] : [this.acquisition];
  }

  public async isAssociatedWithResearchRun(): Promise<boolean> {
    return this.acquisition !== undefined;
  }
}

class SequenceIds implements EvidenceIdGenerator {
  private value = 0;

  public generate(): string {
    return `evidence-${++this.value}`;
  }
}

describe('Evidence acquisition ingestion', () => {
  it('passes the stable acquisition scope and returns repository idempotency status', async () => {
    const repository = new RecordingAcquisitionRepository();
    const ingestion = new SearchResultEvidenceAcquisitionIngestion(repository, {
      idGenerator: new SequenceIds(),
      now: () => new Date('2026-11-14T01:02:03.456Z'),
    });
    const input = {
      search: {
        execute: async () => ({
          query: 'workflow',
          items: [{
            title: ' Workflow   research ',
            url: 'https://EXAMPLE.test/path?b=2&a=1#section',
            snippet: 'Teams   repeat manual work.',
          }],
        }),
      },
      searchInput: { query: 'workflow' },
      searchContext: {
        sessionId: 'session-1',
        researchRunId: 'run-1',
        toolInvocationId: 'tool-1',
      },
      workflowInvocationKey: 'invocation-1',
      stepId: 'market_understanding' as const,
    };

    const created = await ingestion.execute(input);
    const replay = await ingestion.execute(input);

    expect(created.items[0]).toMatchObject({
      status: 'persisted',
      persistenceStatus: 'created',
      evidence: { id: 'evidence-1' },
    });
    expect(replay.items[0]).toMatchObject({
      status: 'persisted',
      persistenceStatus: 'existing',
      evidence: { id: 'evidence-1' },
    });
    expect(repository.inputs[0]).toMatchObject({
      researchRunId: 'run-1',
      workflowInvocationKey: 'invocation-1',
      stepId: 'market_understanding',
      capturedAt: new Date('2026-11-14T01:02:03.456Z'),
    });
    expect(repository.inputs[0]?.sourceFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('normalizes URL identity and insignificant text whitespace before hashing', () => {
    const first = {
      id: 'evidence-1',
      source: { url: 'https://EXAMPLE.test/path?b=2&a=1#fragment' },
      title: 'Workflow   research',
      excerpt: 'Repeated\nmanual work',
      retrievedAt: new Date('2026-11-14T00:00:00.000Z'),
    };
    const second = {
      ...first,
      id: 'evidence-2',
      source: { url: 'https://example.test/path?a=1&b=2' },
      title: 'Workflow research',
      excerpt: 'Repeated manual work',
      retrievedAt: new Date('2026-11-15T00:00:00.000Z'),
    };

    expect(normalizeEvidenceSourceUrl(first.source.url))
      .toBe('https://example.test/path?a=1&b=2');
    expect(createEvidenceSourceFingerprint(first))
      .toBe(createEvidenceSourceFingerprint(second));
  });
});

