import type { FindingId } from '@product-scout/domain';
import type { ClaimId, EvidenceId } from '@product-scout/evidence';

import type {
  ClaimEvidenceTrace,
  ResearchFindingService,
  ResearchFindingTrace,
} from './research-finding-service';

import type {
  ClaimEvidenceAssessmentInput, AssessmentRuleResult,
  QualityRuleId, QualityIssueCode, AssessmentRuleOutcome, QualityIssue,
  ClaimQualityAssessment, ResearchQualityAssessment, ResearchQualityStatus,
} from '@product-scout/evidence';
export type {
  ClaimEvidenceAssessmentInput, AssessmentRuleResult, EvidenceSourceKind, EvidenceSemanticKind,
  ClaimEvidenceRelation, QualityRuleId, QualityIssueCode, AssessmentRuleOutcome, QualityIssue,
  EvidenceConflictCandidate, ClaimQualityAssessment, ResearchQualityAssessment, ResearchQualityStatus,
} from '@product-scout/evidence';

export class InvalidQualityAssessmentInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidQualityAssessmentInputError';
  }
}

interface ResolvedEvidenceAssessment extends ClaimEvidenceAssessmentInput {
  readonly sourceUrl: string;
  readonly provided: boolean;
}

interface RuleEvaluation {
  readonly result: AssessmentRuleResult;
  readonly issue?: QualityIssue;
}

const STRONG_CLAIM_PATTERN = /\b(?:all|always|never|every|guaranteed|certainly|must)\b|所有|全部|普遍|总是|从不|一定|必然/iu;

export function assessResearchFindingQuality(
  trace: ResearchFindingTrace,
  inputs: readonly ClaimEvidenceAssessmentInput[],
): ResearchQualityAssessment {
  const inputByReference = validateAndIndexInputs(trace, inputs);
  const claims = trace.claims.map((claimTrace) =>
    assessClaimQuality(claimTrace, inputByReference));
  const issues = claims.flatMap((claim) => claim.issues);
  const conflictCandidates = claims.flatMap((claim) => claim.conflictCandidates);

  return {
    findingId: trace.finding.id,
    status: aggregateStatus(claims.map((claim) => claim.status)),
    claims,
    issues,
    conflictCandidates,
    requiresHumanReview: claims.some((claim) => claim.requiresHumanReview),
  };
}

export class ResearchQualityAssessmentService {
  public constructor(
    private readonly findingService: Pick<ResearchFindingService, 'traceFinding'>,
  ) {}

  public async assessFinding(
    findingId: FindingId,
    inputs: readonly ClaimEvidenceAssessmentInput[],
  ): Promise<ResearchQualityAssessment> {
    const trace = await this.findingService.traceFinding(findingId);
    return assessResearchFindingQuality(trace, inputs);
  }
}

function assessClaimQuality(
  trace: ClaimEvidenceTrace,
  inputByReference: ReadonlyMap<string, ClaimEvidenceAssessmentInput>,
): ClaimQualityAssessment {
  const assessments = trace.evidence.map((evidence) => {
    const provided = inputByReference.get(referenceKey(trace.claim.id, evidence.id));
    return {
      claimId: trace.claim.id,
      evidenceId: evidence.id,
      relation: provided?.relation ?? 'unclear',
      semanticKind: provided?.semanticKind ?? 'unknown',
      sourceKind: provided?.sourceKind ?? 'unknown',
      sourceUrl: evidence.source.url,
      provided: provided !== undefined,
    } satisfies ResolvedEvidenceAssessment;
  });
  const supporting = assessments.filter((assessment) => assessment.relation === 'supports');
  const contradicting = assessments.filter((assessment) => assessment.relation === 'contradicts');
  const unclear = assessments.filter((assessment) => assessment.relation === 'unclear');
  const supportingUrls = supporting.map((assessment) => normalizeSourceUrl(assessment.sourceUrl));
  const distinctSupportingSourceUrls = unique(supportingUrls);

  const evaluations = [
    evaluateUnassessedRelations(trace.claim.id, assessments),
    evaluateSupportingEvidence(trace.claim.id, assessments, supporting),
    evaluateSingleSource(trace.claim.id, supporting, distinctSupportingSourceUrls),
    evaluateDuplicateSources(trace.claim.id, supporting, supportingUrls),
    evaluateConflict(trace.claim.id, supporting, contradicting),
    evaluateClassification(trace.claim.id, assessments),
    evaluateStrongClaim(
      trace.claim.id,
      trace.claim.text,
      supporting,
      distinctSupportingSourceUrls,
    ),
  ];
  const issues = evaluations.flatMap((evaluation) =>
    evaluation.issue === undefined ? [] : [evaluation.issue]);
  const conflictCandidates = supporting.length > 0 && contradicting.length > 0
    ? [{
        claimId: trace.claim.id,
        supportingEvidenceIds: supporting.map((assessment) => assessment.evidenceId),
        contradictingEvidenceIds: contradicting.map((assessment) => assessment.evidenceId),
        reason: 'Supporting and contradicting relations coexist; content and scope require human review.',
        requiresHumanReview: true as const,
      }]
    : [];

  return {
    claimId: trace.claim.id,
    status: statusFromIssues(issues),
    issues,
    ruleResults: evaluations.map((evaluation) => evaluation.result),
    supportingEvidenceIds: supporting.map((assessment) => assessment.evidenceId),
    contradictingEvidenceIds: contradicting.map((assessment) => assessment.evidenceId),
    unclearEvidenceIds: unclear.map((assessment) => assessment.evidenceId),
    distinctSupportingSourceUrls,
    conflictCandidates,
    requiresHumanReview: issues.some((issue) => issue.requiresHumanReview),
  };
}

function validateAndIndexInputs(
  trace: ResearchFindingTrace,
  inputs: readonly ClaimEvidenceAssessmentInput[],
): ReadonlyMap<string, ClaimEvidenceAssessmentInput> {
  const validReferences = new Set(
    trace.claims.flatMap((claimTrace) =>
      claimTrace.evidence.map((evidence) => referenceKey(claimTrace.claim.id, evidence.id))),
  );
  const indexed = new Map<string, ClaimEvidenceAssessmentInput>();

  for (const input of inputs) {
    const key = referenceKey(input.claimId, input.evidenceId);
    if (!validReferences.has(key)) {
      throw new InvalidQualityAssessmentInputError(
        'Evidence ' + input.evidenceId + ' is not referenced by Claim ' + input.claimId,
      );
    }
    if (indexed.has(key)) {
      throw new InvalidQualityAssessmentInputError(
        'Duplicate assessment for Claim ' + input.claimId + ' and Evidence ' + input.evidenceId,
      );
    }
    indexed.set(key, input);
  }

  return indexed;
}

function evaluateUnassessedRelations(
  claimId: ClaimId,
  assessments: readonly ResolvedEvidenceAssessment[],
): RuleEvaluation {
  const affected = assessments.filter((assessment) =>
    !assessment.provided || assessment.relation === 'unclear');
  return evaluation({
    ruleId: 'RQC-001',
    issueCode: 'UNASSESSED_EVIDENCE_RELATION',
    claimId,
    affected,
    triggered: affected.length > 0,
    blocking: false,
    requiresHumanReview: true,
    triggeredReason: 'One or more Evidence references have no explicit supports or contradicts relation.',
    passedReason: 'Every Evidence reference has an explicit supports or contradicts relation.',
  });
}

function evaluateSupportingEvidence(
  claimId: ClaimId,
  assessments: readonly ResolvedEvidenceAssessment[],
  supporting: readonly ResolvedEvidenceAssessment[],
): RuleEvaluation {
  return evaluation({
    ruleId: 'RQC-002',
    issueCode: 'NO_SUPPORTING_EVIDENCE',
    claimId,
    affected: assessments,
    triggered: supporting.length === 0,
    blocking: true,
    requiresHumanReview: true,
    triggeredReason: 'The Claim has no Evidence explicitly classified as supporting it.',
    passedReason: 'The Claim has at least one supporting Evidence relation.',
  });
}

function evaluateSingleSource(
  claimId: ClaimId,
  supporting: readonly ResolvedEvidenceAssessment[],
  distinctUrls: readonly string[],
): RuleEvaluation {
  const applicable = supporting.length > 0;
  return evaluation({
    ruleId: 'RQC-003',
    issueCode: 'SINGLE_SUPPORTING_SOURCE',
    claimId,
    affected: supporting,
    triggered: applicable && distinctUrls.length < 2,
    applicable,
    blocking: false,
    requiresHumanReview: true,
    triggeredReason: 'The Claim relies on fewer than two distinct supporting source URLs.',
    passedReason: 'The Claim has at least two distinct supporting source URLs.',
    notApplicableReason: 'The Claim has no supporting Evidence, so source diversity cannot be evaluated.',
  });
}

function evaluateDuplicateSources(
  claimId: ClaimId,
  supporting: readonly ResolvedEvidenceAssessment[],
  normalizedUrls: readonly string[],
): RuleEvaluation {
  const duplicatedUrls = normalizedUrls.filter((url, index) =>
    normalizedUrls.indexOf(url) !== index);
  const duplicates = new Set(duplicatedUrls);
  const affected = supporting.filter((assessment) =>
    duplicates.has(normalizeSourceUrl(assessment.sourceUrl)));
  const applicable = supporting.length > 1;
  return evaluation({
    ruleId: 'RQC-004',
    issueCode: 'DUPLICATE_SUPPORTING_SOURCE',
    claimId,
    affected,
    triggered: applicable && duplicates.size > 0,
    applicable,
    blocking: false,
    requiresHumanReview: true,
    triggeredReason: 'Multiple supporting Evidence records resolve to the same normalized source URL.',
    passedReason: 'Supporting Evidence records use distinct normalized source URLs.',
    notApplicableReason: 'Fewer than two supporting Evidence records exist.',
  });
}

function evaluateConflict(
  claimId: ClaimId,
  supporting: readonly ResolvedEvidenceAssessment[],
  contradicting: readonly ResolvedEvidenceAssessment[],
): RuleEvaluation {
  const affected = [...supporting, ...contradicting];
  return evaluation({
    ruleId: 'RQC-005',
    issueCode: 'CONFLICTING_EVIDENCE_RELATIONS',
    claimId,
    affected,
    triggered: supporting.length > 0 && contradicting.length > 0,
    blocking: true,
    requiresHumanReview: true,
    triggeredReason: 'Supporting and contradicting Evidence relations coexist for the Claim.',
    passedReason: 'The Claim does not contain both supporting and contradicting relations.',
  });
}

function evaluateClassification(
  claimId: ClaimId,
  assessments: readonly ResolvedEvidenceAssessment[],
): RuleEvaluation {
  const affected = assessments.filter((assessment) =>
    assessment.semanticKind === 'unknown' || assessment.sourceKind === 'unknown');
  return evaluation({
    ruleId: 'RQC-006',
    issueCode: 'EVIDENCE_CLASSIFICATION_INCOMPLETE',
    claimId,
    affected,
    triggered: affected.length > 0,
    blocking: false,
    requiresHumanReview: true,
    triggeredReason: 'One or more Evidence records lack an explicit semantic or source classification.',
    passedReason: 'Every Evidence record has explicit semantic and source classifications.',
  });
}

function evaluateStrongClaim(
  claimId: ClaimId,
  claimText: string,
  supporting: readonly ResolvedEvidenceAssessment[],
  distinctUrls: readonly string[],
): RuleEvaluation {
  const strong = STRONG_CLAIM_PATTERN.test(claimText);
  return evaluation({
    ruleId: 'RQC-007',
    issueCode: 'STRONG_CLAIM_WITH_LIMITED_SUPPORT',
    claimId,
    affected: supporting,
    triggered: strong && distinctUrls.length < 2,
    applicable: strong,
    blocking: false,
    requiresHumanReview: true,
    triggeredReason: 'The Claim uses strong or universal language with fewer than two distinct supporting sources.',
    passedReason: 'The strong Claim has at least two distinct supporting sources.',
    notApplicableReason: 'The Claim does not use a recognized strong or universal expression.',
  });
}

interface EvaluationOptions {
  readonly ruleId: QualityRuleId;
  readonly issueCode: QualityIssueCode;
  readonly claimId: ClaimId;
  readonly affected: readonly ResolvedEvidenceAssessment[];
  readonly triggered: boolean;
  readonly applicable?: boolean;
  readonly blocking: boolean;
  readonly requiresHumanReview: boolean;
  readonly triggeredReason: string;
  readonly passedReason: string;
  readonly notApplicableReason?: string;
}

function evaluation(options: EvaluationOptions): RuleEvaluation {
  const applicable = options.applicable ?? true;
  const outcome: AssessmentRuleOutcome = !applicable
    ? 'not_applicable'
    : options.triggered
      ? 'triggered'
      : 'passed';
  const reason = outcome === 'triggered'
    ? options.triggeredReason
    : outcome === 'passed'
      ? options.passedReason
      : options.notApplicableReason ?? 'The rule does not apply.';
  const evidenceIds = options.affected.map((assessment) => assessment.evidenceId);
  const sourceUrls = unique(options.affected.map((assessment) => assessment.sourceUrl));
  const result: AssessmentRuleResult = {
    ruleId: options.ruleId,
    outcome,
    claimId: options.claimId,
    evidenceIds,
    reason,
    blocking: outcome === 'triggered' && options.blocking,
    requiresHumanReview: outcome === 'triggered' && options.requiresHumanReview,
  };

  return outcome === 'triggered'
    ? {
        result,
        issue: {
          code: options.issueCode,
          ruleId: options.ruleId,
          claimId: options.claimId,
          evidenceIds,
          sourceUrls,
          reason,
          blocking: options.blocking,
          requiresHumanReview: options.requiresHumanReview,
        },
      }
    : { result };
}

function statusFromIssues(issues: readonly QualityIssue[]): ResearchQualityStatus {
  if (issues.some((issue) => issue.code === 'CONFLICTING_EVIDENCE_RELATIONS')) {
    return 'conflicted';
  }
  if (issues.some((issue) => issue.code === 'NO_SUPPORTING_EVIDENCE')) {
    return 'insufficient';
  }
  return issues.length > 0 ? 'needs_review' : 'sufficient';
}

function aggregateStatus(statuses: readonly ResearchQualityStatus[]): ResearchQualityStatus {
  if (statuses.includes('conflicted')) return 'conflicted';
  if (statuses.includes('insufficient')) return 'insufficient';
  if (statuses.includes('needs_review')) return 'needs_review';
  return 'sufficient';
}

function normalizeSourceUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  return url.toString();
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function referenceKey(claimId: ClaimId, evidenceId: EvidenceId): string {
  return claimId + '\u0000' + evidenceId;
}
