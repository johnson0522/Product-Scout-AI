import type { ResearchRunId } from '@product-scout/domain';
import type { ResearchQualitySnapshot } from './research-quality-model';

export interface ResearchQualitySnapshotRepository {
  /** Reuse an identical replay; never overwrite a different assessment. */
  ensure(snapshot: ResearchQualitySnapshot): Promise<ResearchQualitySnapshot>;
  listByResearchRunId(researchRunId: ResearchRunId): Promise<readonly ResearchQualitySnapshot[]>;
}

export class ResearchQualitySnapshotConflictError extends Error {
  public constructor() {
    super('A different quality assessment already exists in this Finding/invocation/rules scope');
    this.name = 'ResearchQualitySnapshotConflictError';
  }
}
