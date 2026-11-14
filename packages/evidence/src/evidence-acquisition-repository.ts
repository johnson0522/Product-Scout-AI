import type { ResearchRunId } from '@product-scout/domain';

import type { EvidenceId } from './evidence-model';
import type {
  AcquireEvidenceInput,
  AcquireEvidenceResult,
  EvidenceAcquisition,
  EvidenceAcquisitionScope,
} from './evidence-acquisition';

/** Atomic persistence boundary for Evidence and its successful collection. */
export interface EvidenceAcquisitionRepository {
  acquire(input: AcquireEvidenceInput): Promise<AcquireEvidenceResult>;
  getByScope(scope: EvidenceAcquisitionScope): Promise<EvidenceAcquisition | null>;
  listByResearchRunId(
    researchRunId: ResearchRunId,
  ): Promise<readonly EvidenceAcquisition[]>;
  isAssociatedWithResearchRun(
    researchRunId: ResearchRunId,
    evidenceId: EvidenceId,
  ): Promise<boolean>;
}

