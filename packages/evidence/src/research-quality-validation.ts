import {
  RESEARCH_QUALITY_RULES_VERSION,
  type AssessmentRuleResult,
  type ClaimEvidenceAssessmentInput,
  type ClaimQualityAssessment,
  type EvidenceConflictCandidate,
  type QualityIssue,
  type ResearchQualityAssessment,
  type ResearchQualitySnapshot,
} from './research-quality-model';

const ruleIds = ['RQC-001', 'RQC-002', 'RQC-003', 'RQC-004', 'RQC-005', 'RQC-006', 'RQC-007'] as const;
const statuses = ['sufficient', 'insufficient', 'conflicted', 'needs_review'] as const;
const issueCodes = ['UNASSESSED_EVIDENCE_RELATION', 'NO_SUPPORTING_EVIDENCE', 'SINGLE_SUPPORTING_SOURCE',
  'DUPLICATE_SUPPORTING_SOURCE', 'CONFLICTING_EVIDENCE_RELATIONS', 'EVIDENCE_CLASSIFICATION_INCOMPLETE',
  'STRONG_CLAIM_WITH_LIMITED_SUPPORT'] as const;

export class InvalidResearchQualitySnapshotError extends Error {
  public constructor() {
    super('Invalid research quality snapshot');
    this.name = 'InvalidResearchQualitySnapshotError';
  }
}

/** Decode persisted JSON using an explicit allowlist; no runtime prose or trajectory. */
export function createResearchQualitySnapshot(value: unknown): ResearchQualitySnapshot {
  const input = object(value);
  if (!(input.assessedAt instanceof Date) || !Number.isFinite(input.assessedAt.getTime())) fail();
  const snapshot: ResearchQualitySnapshot = {
    researchRunId: text(input.researchRunId),
    findingId: text(input.findingId),
    workflowInvocationKey: text(input.workflowInvocationKey),
    rulesVersion: member(input.rulesVersion, [RESEARCH_QUALITY_RULES_VERSION]),
    assessedAt: new Date(input.assessedAt.getTime()),
    inputs: array(input.inputs).map(parseInput),
    assessment: parseAssessment(input.assessment),
  };
  if (snapshot.findingId !== snapshot.assessment.findingId) fail();
  const claims = new Map(snapshot.assessment.claims.map((claim) => [claim.claimId, claim]));
  if (claims.size !== snapshot.assessment.claims.length || claims.size === 0) fail();
  const pairs = snapshot.inputs.map((item) => `${item.claimId}\0${item.evidenceId}`);
  if (new Set(pairs).size !== pairs.length) fail();
  for (const item of snapshot.inputs) {
    const claim = claims.get(item.claimId);
    const refs = item.relation === 'supports' ? claim?.supportingEvidenceIds
      : item.relation === 'contradicts' ? claim?.contradictingEvidenceIds : claim?.unclearEvidenceIds;
    if (!refs?.includes(item.evidenceId)) fail();
  }
  for (const claim of claims.values()) {
    const refs = [...claim.supportingEvidenceIds, ...claim.contradictingEvidenceIds, ...claim.unclearEvidenceIds];
    if (new Set(refs).size !== refs.length || refs.length === 0) fail();
    if (refs.some((id) => !pairs.includes(`${claim.claimId}\0${id}`))) fail();
    if (claim.issues.some((issue) => issue.claimId !== claim.claimId || issue.evidenceIds.some((id) => !refs.includes(id)))) fail();
    if (claim.ruleResults.length !== ruleIds.length || new Set(claim.ruleResults.map((r) => r.ruleId)).size !== ruleIds.length) fail();
    if (claim.ruleResults.some((rule) => rule.claimId !== claim.claimId || rule.evidenceIds.some((id) => !refs.includes(id)))) fail();
    if (claim.requiresHumanReview !== claim.issues.some((issue) => issue.requiresHumanReview)) fail();
    const expected = claim.issues.some((issue) => issue.code === 'CONFLICTING_EVIDENCE_RELATIONS') ? 'conflicted'
      : claim.issues.some((issue) => issue.code === 'NO_SUPPORTING_EVIDENCE') ? 'insufficient'
      : claim.issues.length > 0 ? 'needs_review' : 'sufficient';
    if (claim.status !== expected) fail();
    for (const rule of claim.ruleResults) {
      const issue = claim.issues.find((item) => item.ruleId === rule.ruleId);
      if ((rule.outcome === 'triggered') !== (issue !== undefined)) fail();
      if (issue && (rule.blocking !== issue.blocking || rule.requiresHumanReview !== issue.requiresHumanReview)) fail();
    }
  }
  const issues = snapshot.assessment.claims.flatMap((claim) => claim.issues);
  if (JSON.stringify(issues) !== JSON.stringify(snapshot.assessment.issues)) fail();
  if (snapshot.assessment.requiresHumanReview !== issues.some((issue) => issue.requiresHumanReview)) fail();
  const expected = ['conflicted', 'insufficient', 'needs_review', 'sufficient'].find((status) =>
    snapshot.assessment.claims.some((claim) => claim.status === status));
  if (snapshot.assessment.status !== expected) fail();
  if (JSON.stringify(snapshot.assessment.conflictCandidates)
    !== JSON.stringify(snapshot.assessment.claims.flatMap((claim) => claim.conflictCandidates))) fail();
  return snapshot;
}

function parseInput(value: unknown): ClaimEvidenceAssessmentInput {
  const item = object(value);
  return {
    claimId: text(item.claimId), evidenceId: text(item.evidenceId),
    relation: member(item.relation, ['supports', 'contradicts', 'unclear']),
    semanticKind: member(item.semanticKind, ['verifiable_fact', 'user_report', 'analysis', 'recommendation', 'unknown']),
    sourceKind: member(item.sourceKind, ['primary_research', 'first_party', 'community', 'independent_third_party', 'other', 'unknown']),
  };
}

function parseAssessment(value: unknown): ResearchQualityAssessment {
  const item = object(value);
  return {
    findingId: text(item.findingId), status: member(item.status, statuses),
    claims: array(item.claims).map(parseClaim), issues: array(item.issues).map(parseIssue),
    conflictCandidates: array(item.conflictCandidates).map(parseConflict),
    requiresHumanReview: boolean(item.requiresHumanReview),
  };
}

function parseClaim(value: unknown): ClaimQualityAssessment {
  const item = object(value);
  return {
    claimId: text(item.claimId), status: member(item.status, statuses),
    issues: array(item.issues).map(parseIssue), ruleResults: array(item.ruleResults).map(parseRule),
    supportingEvidenceIds: strings(item.supportingEvidenceIds), contradictingEvidenceIds: strings(item.contradictingEvidenceIds),
    unclearEvidenceIds: strings(item.unclearEvidenceIds), distinctSupportingSourceUrls: urls(item.distinctSupportingSourceUrls),
    conflictCandidates: array(item.conflictCandidates).map(parseConflict), requiresHumanReview: boolean(item.requiresHumanReview),
  };
}

function parseIssue(value: unknown): QualityIssue {
  const item = object(value);
  return {
    ruleId: member(item.ruleId, ruleIds), code: member(item.code, issueCodes), claimId: text(item.claimId),
    evidenceIds: strings(item.evidenceIds), sourceUrls: urls(item.sourceUrls), reason: text(item.reason),
    blocking: boolean(item.blocking), requiresHumanReview: boolean(item.requiresHumanReview),
  };
}

function parseRule(value: unknown): AssessmentRuleResult {
  const item = object(value);
  return {
    ruleId: member(item.ruleId, ruleIds), outcome: member(item.outcome, ['passed', 'triggered', 'not_applicable']),
    claimId: text(item.claimId), evidenceIds: strings(item.evidenceIds), reason: text(item.reason),
    blocking: boolean(item.blocking), requiresHumanReview: boolean(item.requiresHumanReview),
  };
}

function parseConflict(value: unknown): EvidenceConflictCandidate {
  const item = object(value);
  if (item.requiresHumanReview !== true) fail();
  return {
    claimId: text(item.claimId), supportingEvidenceIds: strings(item.supportingEvidenceIds),
    contradictingEvidenceIds: strings(item.contradictingEvidenceIds), reason: text(item.reason), requiresHumanReview: true,
  };
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function array(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : fail(); }
function text(value: unknown): string { return typeof value === 'string' && value.trim() !== '' ? value : fail(); }
function strings(value: unknown): readonly string[] { return array(value).map(text); }
function urls(value: unknown): readonly string[] {
  return strings(value).map((item) => {
    try { if (!['https:', 'http:'].includes(new URL(item).protocol)) return fail(); }
    catch { return fail(); }
    return item;
  });
}
function boolean(value: unknown): boolean { return typeof value === 'boolean' ? value : fail(); }
function member<const T extends readonly string[]>(value: unknown, values: T): T[number] {
  return values.find((item) => item === value) ?? fail();
}
function fail(): never { throw new InvalidResearchQualitySnapshotError(); }
