import { createHash } from 'node:crypto';

import {
  createEvidence,
  type EvidenceAcquisition,
  type EvidenceAcquisitionRepository,
  type Evidence,
  type EvidenceId,
  type EvidenceRepository,
} from '@product-scout/evidence';
import type { ResearchStepType } from '@product-scout/domain';

import type {
  SearchResultItem,
  SearchTool,
  SearchToolContext,
  SearchToolInput,
} from './search';

export interface EvidenceIdGenerator {
  generate(): EvidenceId;
}

export interface EvidenceIngestionOptions {
  readonly idGenerator?: EvidenceIdGenerator;
  readonly now?: () => Date;
}

export interface EvidenceMappingContext {
  readonly idGenerator: EvidenceIdGenerator;
  readonly now: () => Date;
}

export type EvidenceIngestionItemResult =
  | {
      readonly status: 'persisted';
      readonly item: SearchResultItem;
      readonly evidence: Evidence;
      readonly persistenceStatus?: 'created' | 'existing';
      readonly acquisition?: EvidenceAcquisition;
    }
  | {
      readonly status: 'mapping_failed';
      readonly item: SearchResultItem;
      readonly errorMessage: string;
    }
  | {
      readonly status: 'persistence_failed';
      readonly item: SearchResultItem;
      readonly evidence: Evidence;
      readonly errorMessage: string;
    };

export interface EvidenceIngestionResult {
  readonly query: string;
  readonly total: number;
  readonly mapped: number;
  readonly persisted: number;
  readonly items: readonly EvidenceIngestionItemResult[];
}

export interface EvidenceAcquisitionIngestionInput extends EvidenceIngestionInput {
  readonly workflowInvocationKey: string;
  readonly stepId: ResearchStepType;
}

export interface EvidenceAcquisitionIngestionExecutor {
  execute(input: EvidenceAcquisitionIngestionInput): Promise<EvidenceIngestionResult>;
}

export type SearchExecutor = Pick<SearchTool, 'execute'>;

export interface EvidenceIngestionInput {
  readonly search: SearchExecutor;
  readonly searchInput: SearchToolInput;
  readonly searchContext: SearchToolContext;
}

export class SearchResultEvidenceMapper {
  public constructor(private readonly context: EvidenceMappingContext) {}

  public map(item: SearchResultItem): Evidence {
    return createEvidence({
      id: this.context.idGenerator.generate(),
      source: {
        url: item.url,
        title: item.title,
      },
      title: item.title,
      excerpt: item.snippet,
      retrievedAt: this.context.now(),
    });
  }
}

export class SearchResultEvidenceIngestion {
  private readonly mapper: SearchResultEvidenceMapper;

  public constructor(
    private readonly repository: EvidenceRepository,
    options: EvidenceIngestionOptions = {},
  ) {
    this.mapper = new SearchResultEvidenceMapper({
      idGenerator: options.idGenerator ?? new CryptoEvidenceIdGenerator(),
      now: options.now ?? (() => new Date()),
    });
  }

  public async execute(input: EvidenceIngestionInput): Promise<EvidenceIngestionResult> {
    const searchResult = await input.search.execute(input.searchInput, input.searchContext);
    const results: EvidenceIngestionItemResult[] = [];
    let mapped = 0;
    let persisted = 0;

    for (const item of searchResult.items) {
      let evidence: Evidence;
      try {
        evidence = this.mapper.map(item);
        mapped += 1;
      } catch (error: unknown) {
        results.push({
          status: 'mapping_failed',
          item,
          errorMessage: errorMessage(error),
        });
        continue;
      }

      try {
        await this.repository.create(evidence);
        persisted += 1;
        results.push({ status: 'persisted', item, evidence });
      } catch (error: unknown) {
        results.push({
          status: 'persistence_failed',
          item,
          evidence,
          errorMessage: errorMessage(error),
        });
      }
    }

    return {
      query: searchResult.query,
      total: searchResult.items.length,
      mapped,
      persisted,
      items: results,
    };
  }
}

/**
 * Persists Evidence and its successful ResearchRun acquisition atomically.
 * Replaying the same scoped acquisition returns the original Evidence.
 */
export class SearchResultEvidenceAcquisitionIngestion
implements EvidenceAcquisitionIngestionExecutor {
  private readonly mapper: SearchResultEvidenceMapper;

  public constructor(
    private readonly repository: EvidenceAcquisitionRepository,
    options: EvidenceIngestionOptions = {},
  ) {
    this.mapper = new SearchResultEvidenceMapper({
      idGenerator: options.idGenerator ?? new CryptoEvidenceIdGenerator(),
      now: options.now ?? (() => new Date()),
    });
  }

  public async execute(
    input: EvidenceAcquisitionIngestionInput,
  ): Promise<EvidenceIngestionResult> {
    const searchResult = await input.search.execute(input.searchInput, input.searchContext);
    const results: EvidenceIngestionItemResult[] = [];
    let mapped = 0;
    let persisted = 0;

    for (const item of searchResult.items) {
      let evidence: Evidence;
      try {
        evidence = this.mapper.map(item);
        mapped += 1;
      } catch (error: unknown) {
        results.push({
          status: 'mapping_failed',
          item,
          errorMessage: errorMessage(error),
        });
        continue;
      }

      try {
        const acquired = await this.repository.acquire({
          evidence,
          researchRunId: input.searchContext.researchRunId,
          workflowInvocationKey: input.workflowInvocationKey,
          stepId: input.stepId,
          sourceFingerprint: createEvidenceSourceFingerprint(evidence),
          capturedAt: evidence.retrievedAt,
        });
        persisted += 1;
        results.push({
          status: 'persisted',
          item,
          evidence: acquired.evidence,
          persistenceStatus: acquired.status,
          acquisition: acquired.acquisition,
        });
      } catch (error: unknown) {
        results.push({
          status: 'persistence_failed',
          item,
          evidence,
          errorMessage: errorMessage(error),
        });
      }
    }

    return {
      query: searchResult.query,
      total: searchResult.items.length,
      mapped,
      persisted,
      items: results,
    };
  }
}

export function createEvidenceSourceFingerprint(evidence: Evidence): string {
  const identity = JSON.stringify([
    normalizeEvidenceSourceUrl(evidence.source.url),
    normalizeEvidenceIdentityText(evidence.title),
    normalizeEvidenceIdentityText(evidence.excerpt),
  ]);
  return `sha256:${createHash('sha256').update(identity, 'utf8').digest('hex')}`;
}

export function normalizeEvidenceSourceUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  const entries = [...url.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) =>
    leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  url.search = '';
  for (const [key, value] of entries) url.searchParams.append(key, value);
  return url.toString();
}

function normalizeEvidenceIdentityText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

class CryptoEvidenceIdGenerator implements EvidenceIdGenerator {
  public generate(): EvidenceId {
    const randomUuid = globalThis.crypto?.randomUUID;
    if (randomUuid === undefined) {
      throw new Error('crypto.randomUUID is required to generate an EvidenceId');
    }
    return randomUuid.call(globalThis.crypto);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
