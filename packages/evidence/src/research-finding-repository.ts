import type {
  Finding,
  FindingId,
  ResearchRunId,
} from '@product-scout/domain';

export interface ResearchFindingRepository {
  create(finding: Finding): Promise<void>;
  getById(id: FindingId): Promise<Finding | null>;
  listByResearchRunId(researchRunId: ResearchRunId): Promise<readonly Finding[]>;
}
