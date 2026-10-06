import type { Evidence } from '@product-scout/domain';

export interface EvidenceService {
  addEvidence(researchId: string, evidence: EvidenceInput): Promise<Evidence>;
  getEvidence(researchId: string): Promise<Evidence[]>;
  assessRelevance(evidence: Evidence): number;
}

export interface EvidenceInput {
  source: string;
  url: string;
  content: string;
}

export type { Evidence };
