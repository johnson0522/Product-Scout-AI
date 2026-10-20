import type { ResearchRunId } from '@product-scout/domain';

import type { Claim, ClaimId } from './claim-model';

export interface ClaimRepository {
  create(claim: Claim): Promise<void>;
  getById(id: ClaimId): Promise<Claim | null>;
  listByResearchRunId(researchRunId: ResearchRunId): Promise<readonly Claim[]>;
}
