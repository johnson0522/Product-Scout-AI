import { createHash } from 'node:crypto';

import type { Finding } from '@product-scout/domain';
import type { EvidenceId } from '@product-scout/evidence';

import type {
  ClaimEvidenceRelation,
  EvidenceSemanticKind,
  EvidenceSourceKind,
} from './research-quality';
import type { ResearchWorkflowStepId } from './research-workflow';

export interface ResearchSynthesisEvidenceInput {
  readonly evidenceId: EvidenceId;
  readonly stepId: Exclude<
    ResearchWorkflowStepId,
    'opportunity_analysis' | 'report_generation'
  >;
}

export interface ResearchSynthesisPlanInput {
  readonly researchRunId: string;
  readonly goal: string;
  readonly invocationKey: string;
  readonly evidence: readonly ResearchSynthesisEvidenceInput[];
}

export interface ResearchClaimDraft {
  /** Stable identifier within this synthesis plan. */
  readonly id: string;
  readonly text: string;
  readonly evidenceIds: readonly EvidenceId[];
}

export interface ResearchFindingDraft {
  /** Stable identifier within this synthesis plan. */
  readonly id: string;
  readonly type: Finding['type'];
  readonly title: string;
  readonly description: string;
  readonly claimIds: readonly string[];
}

export interface ResearchEvidenceAssessmentDraft {
  readonly claimId: string;
  readonly evidenceId: EvidenceId;
  readonly relation: ClaimEvidenceRelation;
  readonly semanticKind: EvidenceSemanticKind;
  readonly sourceKind: EvidenceSourceKind;
}

export interface ResearchSynthesisPlan {
  readonly claims: readonly ResearchClaimDraft[];
  readonly findings: readonly ResearchFindingDraft[];
  readonly assessments: readonly ResearchEvidenceAssessmentDraft[];
}

export interface ResearchSynthesisPlanProvider {
  createPlan(input: ResearchSynthesisPlanInput): Promise<ResearchSynthesisPlan>;
}

export class InvalidResearchSynthesisPlanError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidResearchSynthesisPlanError';
  }
}

const findingTypes: readonly Finding['type'][] = ['opportunity', 'risk', 'insight'];
const relations: readonly ClaimEvidenceRelation[] = ['supports', 'contradicts', 'unclear'];
const semanticKinds: readonly EvidenceSemanticKind[] = [
  'verifiable_fact',
  'user_report',
  'analysis',
  'recommendation',
  'unknown',
];
const sourceKinds: readonly EvidenceSourceKind[] = [
  'primary_research',
  'first_party',
  'community',
  'independent_third_party',
  'other',
  'unknown',
];

/** Parses untrusted runtime output without assuming the model followed the contract. */
export function parseResearchSynthesisPlan(value: unknown): ResearchSynthesisPlan {
  const root = exactRecord(value, ['claims', 'findings', 'assessments'], 'synthesis plan');
  return {
    claims: array(root.claims, 'claims').map((item, index) => parseClaim(item, index)),
    findings: array(root.findings, 'findings').map((item, index) => parseFinding(item, index)),
    assessments: array(root.assessments, 'assessments').map((item, index) =>
      parseAssessment(item, index)),
  };
}

export function validateResearchSynthesisPlan(
  plan: ResearchSynthesisPlan,
  availableEvidenceIds: ReadonlySet<EvidenceId>,
): ResearchSynthesisPlan {
  if (plan.claims.length === 0) {
    throw new InvalidResearchSynthesisPlanError('claims must contain at least one draft');
  }
  if (plan.findings.length === 0) {
    throw new InvalidResearchSynthesisPlanError('findings must contain at least one draft');
  }

  const claimIds = new Set<string>();
  const claims = plan.claims.map((draft) => {
    const id = nonEmpty(draft.id, 'claim id');
    if (claimIds.has(id)) {
      throw new InvalidResearchSynthesisPlanError(`Duplicate claim draft id: ${id}`);
    }
    claimIds.add(id);
    const evidenceIds = uniqueNonEmpty(draft.evidenceIds, `Claim ${id} evidenceIds`);
    for (const evidenceId of evidenceIds) {
      if (!availableEvidenceIds.has(evidenceId)) {
        throw new InvalidResearchSynthesisPlanError(
          `Claim ${id} references Evidence outside the completed workflow: ${evidenceId}`,
        );
      }
    }
    return { id, text: nonEmpty(draft.text, `Claim ${id} text`), evidenceIds };
  });

  const findingIds = new Set<string>();
  const findings = plan.findings.map((draft) => {
    const id = nonEmpty(draft.id, 'finding id');
    if (findingIds.has(id)) {
      throw new InvalidResearchSynthesisPlanError(`Duplicate finding draft id: ${id}`);
    }
    findingIds.add(id);
    if (!findingTypes.includes(draft.type)) {
      throw new InvalidResearchSynthesisPlanError(`Invalid Finding type for ${id}`);
    }
    const referencedClaimIds = uniqueNonEmpty(draft.claimIds, `Finding ${id} claimIds`);
    for (const claimId of referencedClaimIds) {
      if (!claimIds.has(claimId)) {
        throw new InvalidResearchSynthesisPlanError(
          `Finding ${id} references unknown Claim draft: ${claimId}`,
        );
      }
    }
    return {
      id,
      type: draft.type,
      title: nonEmpty(draft.title, `Finding ${id} title`),
      description: nonEmpty(draft.description, `Finding ${id} description`),
      claimIds: referencedClaimIds,
    };
  });

  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  const assessmentKeys = new Set<string>();
  const assessments = plan.assessments.map((assessment) => {
    const claimId = nonEmpty(assessment.claimId, 'assessment claimId');
    const evidenceId = nonEmpty(assessment.evidenceId, 'assessment evidenceId');
    const claim = claimById.get(claimId);
    if (claim === undefined || !claim.evidenceIds.includes(evidenceId)) {
      throw new InvalidResearchSynthesisPlanError(
        `Assessment references an invalid Claim/Evidence pair: ${claimId}/${evidenceId}`,
      );
    }
    const key = `${claimId}\u0000${evidenceId}`;
    if (assessmentKeys.has(key)) {
      throw new InvalidResearchSynthesisPlanError(
        `Duplicate assessment for Claim ${claimId} and Evidence ${evidenceId}`,
      );
    }
    assessmentKeys.add(key);
    if (!relations.includes(assessment.relation)) {
      throw new InvalidResearchSynthesisPlanError(`Invalid Evidence relation for Claim ${claimId}`);
    }
    if (!semanticKinds.includes(assessment.semanticKind)) {
      throw new InvalidResearchSynthesisPlanError(`Invalid semantic kind for Claim ${claimId}`);
    }
    if (!sourceKinds.includes(assessment.sourceKind)) {
      throw new InvalidResearchSynthesisPlanError(`Invalid source kind for Claim ${claimId}`);
    }
    return { ...assessment, claimId, evidenceId };
  });

  for (const claim of claims) {
    for (const evidenceId of claim.evidenceIds) {
      const key = `${claim.id}\u0000${evidenceId}`;
      if (!assessmentKeys.has(key)) {
        throw new InvalidResearchSynthesisPlanError(
          `Missing explicit assessment for Claim ${claim.id} and Evidence ${evidenceId}`,
        );
      }
    }
  }

  return { claims, findings, assessments };
}

export function createSynthesisAggregateId(
  researchRunId: string,
  invocationKey: string,
  aggregate: 'claim' | 'finding',
  draftId: string,
): string {
  const identity = [
    nonEmpty(researchRunId, 'researchRunId'),
    nonEmpty(invocationKey, 'invocationKey'),
    aggregate,
    nonEmpty(draftId, 'draftId'),
  ].join('\u0000');
  const digest = createHash('sha256').update(identity, 'utf8').digest('hex');
  return `synthesis:${aggregate}:${digest}`;
}

function uniqueNonEmpty(values: readonly string[], field: string): readonly string[] {
  if (values.length === 0) {
    throw new InvalidResearchSynthesisPlanError(`${field} must contain at least one value`);
  }
  const normalized = values.map((value) => nonEmpty(value, field));
  if (new Set(normalized).size !== normalized.length) {
    throw new InvalidResearchSynthesisPlanError(`${field} must not contain duplicates`);
  }
  return normalized;
}

function nonEmpty(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidResearchSynthesisPlanError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function parseClaim(value: unknown, index: number): ResearchClaimDraft {
  const field = `claims[${index}]`;
  const record = exactRecord(value, ['id', 'text', 'evidenceIds'], field);
  return {
    id: unknownString(record.id, `${field}.id`),
    text: unknownString(record.text, `${field}.text`),
    evidenceIds: array(record.evidenceIds, `${field}.evidenceIds`).map((item, itemIndex) =>
      unknownString(item, `${field}.evidenceIds[${itemIndex}]`)),
  };
}

function parseFinding(value: unknown, index: number): ResearchFindingDraft {
  const field = `findings[${index}]`;
  const record = exactRecord(value, ['id', 'type', 'title', 'description', 'claimIds'], field);
  return {
    id: unknownString(record.id, `${field}.id`),
    type: findingType(record.type, `${field}.type`),
    title: unknownString(record.title, `${field}.title`),
    description: unknownString(record.description, `${field}.description`),
    claimIds: array(record.claimIds, `${field}.claimIds`).map((item, itemIndex) =>
      unknownString(item, `${field}.claimIds[${itemIndex}]`)),
  };
}

function parseAssessment(value: unknown, index: number): ResearchEvidenceAssessmentDraft {
  const field = `assessments[${index}]`;
  const record = exactRecord(
    value,
    ['claimId', 'evidenceId', 'relation', 'semanticKind', 'sourceKind'],
    field,
  );
  return {
    claimId: unknownString(record.claimId, `${field}.claimId`),
    evidenceId: unknownString(record.evidenceId, `${field}.evidenceId`),
    relation: relation(record.relation, `${field}.relation`),
    semanticKind: semanticKind(record.semanticKind, `${field}.semanticKind`),
    sourceKind: sourceKind(record.sourceKind, `${field}.sourceKind`),
  };
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  field: string,
): Readonly<Record<string, unknown>> {
  if (!isUnknownRecord(value)) {
    throw new InvalidResearchSynthesisPlanError(`${field} must be an object`);
  }
  const record: Readonly<Record<string, unknown>> = value;
  const expected = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!expected.has(key)) {
      throw new InvalidResearchSynthesisPlanError(`${field} contains unknown field: ${key}`);
    }
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new InvalidResearchSynthesisPlanError(`${field} is missing required field: ${key}`);
    }
  }
  return record;
}

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function array(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new InvalidResearchSynthesisPlanError(`${field} must be an array`);
  }
  return value;
}

function unknownString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new InvalidResearchSynthesisPlanError(`${field} must be a string`);
  }
  return nonEmpty(value, field);
}

function findingType(value: unknown, field: string): Finding['type'] {
  if (value === 'opportunity' || value === 'risk' || value === 'insight') return value;
  throw new InvalidResearchSynthesisPlanError(`${field} is invalid`);
}

function relation(value: unknown, field: string): ClaimEvidenceRelation {
  if (value === 'supports' || value === 'contradicts' || value === 'unclear') return value;
  throw new InvalidResearchSynthesisPlanError(`${field} is invalid`);
}

function semanticKind(value: unknown, field: string): EvidenceSemanticKind {
  if (
    value === 'verifiable_fact'
    || value === 'user_report'
    || value === 'analysis'
    || value === 'recommendation'
    || value === 'unknown'
  ) return value;
  throw new InvalidResearchSynthesisPlanError(`${field} is invalid`);
}

function sourceKind(value: unknown, field: string): EvidenceSourceKind {
  if (
    value === 'primary_research'
    || value === 'first_party'
    || value === 'community'
    || value === 'independent_third_party'
    || value === 'other'
    || value === 'unknown'
  ) return value;
  throw new InvalidResearchSynthesisPlanError(`${field} is invalid`);
}
