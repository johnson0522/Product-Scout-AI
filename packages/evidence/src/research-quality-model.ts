import type { FindingId, ResearchRunId } from '@product-scout/domain';
import type { ClaimId } from './claim-model';
import type { EvidenceId } from './evidence-model';

export type EvidenceSemanticKind =
  | 'verifiable_fact'
  | 'user_report'
  | 'analysis'
  | 'recommendation'
  | 'unknown';

export type EvidenceSourceKind =
  | 'primary_research'
  | 'first_party'
  | 'community'
  | 'independent_third_party'
  | 'other'
  | 'unknown';

export type ClaimEvidenceRelation = 'supports' | 'contradicts' | 'unclear';

export type ResearchQualityStatus =
  | 'sufficient'
  | 'insufficient'
  | 'conflicted'
  | 'needs_review';

export type QualityRuleId =
  | 'RQC-001'
  | 'RQC-002'
  | 'RQC-003'
  | 'RQC-004'
  | 'RQC-005'
  | 'RQC-006'
  | 'RQC-007';

export type QualityIssueCode =
  | 'UNASSESSED_EVIDENCE_RELATION'
  | 'NO_SUPPORTING_EVIDENCE'
  | 'SINGLE_SUPPORTING_SOURCE'
  | 'DUPLICATE_SUPPORTING_SOURCE'
  | 'CONFLICTING_EVIDENCE_RELATIONS'
  | 'EVIDENCE_CLASSIFICATION_INCOMPLETE'
  | 'STRONG_CLAIM_WITH_LIMITED_SUPPORT';

export type AssessmentRuleOutcome = 'passed' | 'triggered' | 'not_applicable';

export interface ClaimEvidenceAssessmentInput {
  readonly claimId: ClaimId;
  readonly evidenceId: EvidenceId;
  readonly relation: ClaimEvidenceRelation;
  readonly semanticKind: EvidenceSemanticKind;
  readonly sourceKind: EvidenceSourceKind;
}

export interface QualityIssue {
  readonly code: QualityIssueCode;
  readonly ruleId: QualityRuleId;
  readonly claimId: ClaimId;
  readonly evidenceIds: readonly EvidenceId[];
  readonly sourceUrls: readonly string[];
  readonly reason: string;
  readonly blocking: boolean;
  readonly requiresHumanReview: boolean;
}

export interface AssessmentRuleResult {
  readonly ruleId: QualityRuleId;
  readonly outcome: AssessmentRuleOutcome;
  readonly claimId: ClaimId;
  readonly evidenceIds: readonly EvidenceId[];
  readonly reason: string;
  readonly blocking: boolean;
  readonly requiresHumanReview: boolean;
}

export interface EvidenceConflictCandidate {
  readonly claimId: ClaimId;
  readonly supportingEvidenceIds: readonly EvidenceId[];
  readonly contradictingEvidenceIds: readonly EvidenceId[];
  readonly reason: string;
  readonly requiresHumanReview: true;
}

export interface ClaimQualityAssessment {
  readonly claimId: ClaimId;
  readonly status: ResearchQualityStatus;
  readonly issues: readonly QualityIssue[];
  readonly ruleResults: readonly AssessmentRuleResult[];
  readonly supportingEvidenceIds: readonly EvidenceId[];
  readonly contradictingEvidenceIds: readonly EvidenceId[];
  readonly unclearEvidenceIds: readonly EvidenceId[];
  readonly distinctSupportingSourceUrls: readonly string[];
  readonly conflictCandidates: readonly EvidenceConflictCandidate[];
  readonly requiresHumanReview: boolean;
}

export interface ResearchQualityAssessment {
  readonly findingId: FindingId;
  readonly status: ResearchQualityStatus;
  readonly claims: readonly ClaimQualityAssessment[];
  readonly issues: readonly QualityIssue[];
  readonly conflictCandidates: readonly EvidenceConflictCandidate[];
  readonly requiresHumanReview: boolean;
}


export const RESEARCH_QUALITY_RULES_VERSION = 'rqc-v1' as const;

export interface ResearchQualitySnapshot {
  readonly researchRunId: ResearchRunId;
  readonly findingId: FindingId;
  readonly workflowInvocationKey: string;
  readonly rulesVersion: typeof RESEARCH_QUALITY_RULES_VERSION;
  readonly assessedAt: Date;
  readonly inputs: readonly ClaimEvidenceAssessmentInput[];
  readonly assessment: ResearchQualityAssessment;
}
