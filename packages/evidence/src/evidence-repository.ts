import type { Evidence, EvidenceId } from './evidence-model';

/** Persistence boundary for validated C2 evidence objects. */
export interface EvidenceRepository {
  create(evidence: Evidence): Promise<void>;
  getById(id: EvidenceId): Promise<Evidence | null>;
}