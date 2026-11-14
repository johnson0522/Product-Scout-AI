import { createHash } from 'node:crypto';

import {
  calculateOpportunityScore,
  type Finding,
  type Opportunity,
  type OpportunityScore,
  type OpportunityScoreDimension,
  type OpportunityScoreInput,
  type OpportunityScoreReasoning,
  type ResearchRunId,
} from '@product-scout/domain';
import type { EvidenceId } from '@product-scout/evidence';

import type { ResearchQualityStatus } from './research-quality';

export interface OpportunityAnalysisFindingInput {
  readonly findingId: Finding['id'];
  readonly type: Finding['type'];
  readonly title: string;
  readonly description: string;
  readonly claimIds: readonly string[];
  readonly evidenceIds: readonly EvidenceId[];
  readonly qualityStatus: ResearchQualityStatus;
  readonly requiresHumanReview: boolean;
}

export interface OpportunityAnalysisPlanInput {
  readonly researchRunId: ResearchRunId;
  readonly goal: string;
  readonly invocationKey: string;
  readonly findings: readonly OpportunityAnalysisFindingInput[];
}

export interface OpportunityScoreFactorDraft {
  readonly value: number;
  readonly reasoning: string;
}

export type OpportunityScoreFactorsDraft = Readonly<Record<
  OpportunityScoreDimension,
  OpportunityScoreFactorDraft
>>;

export interface OpportunityDraft {
  /** Stable identifier within one analysis plan. */
  readonly id: string;
  readonly findingIds: readonly Finding['id'][];
  readonly title: string;
  readonly targetCustomer: string;
  readonly problem: string;
  readonly solution: string;
  readonly whyNow: string;
  readonly monetization: string;
  readonly mvp: string;
  readonly confidence: number;
  readonly scoreFactors: OpportunityScoreFactorsDraft;
}

export interface OpportunityAnalysisPlan {
  readonly opportunities: readonly OpportunityDraft[];
}

export interface OpportunityAnalysisPlanProvider {
  createPlan(input: OpportunityAnalysisPlanInput): Promise<OpportunityAnalysisPlan>;
}

/** Application-owned persistence boundary; concrete storage remains infrastructure-owned. */
export interface OpportunityStore {
  getById(id: Opportunity['id']): Promise<Opportunity | null>;
  ensure(opportunity: Opportunity): Promise<Opportunity>;
}

export class OpportunityAnalysisService {
  public constructor(private readonly provider: OpportunityAnalysisPlanProvider) {}

  public async analyze(
    input: OpportunityAnalysisPlanInput,
  ): Promise<readonly ScoredOpportunityProposal[]> {
    const plan = await this.provider.createPlan(input);
    return scoreOpportunityAnalysisPlan(plan, input);
  }
}

export interface ScoredOpportunityProposal {
  readonly draftId: string;
  readonly researchRunId: ResearchRunId;
  readonly findingIds: readonly Finding['id'][];
  readonly evidenceIds: readonly EvidenceId[];
  readonly title: string;
  readonly targetCustomer: string;
  readonly problem: string;
  readonly solution: string;
  readonly whyNow: string;
  readonly monetization: string;
  readonly mvp: string;
  readonly confidence: number;
  readonly score: OpportunityScore;
  readonly scoreReasoning: OpportunityScoreReasoning;
}

export class InvalidOpportunityAnalysisPlanError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidOpportunityAnalysisPlanError';
  }
}

const scoreDimensions: readonly OpportunityScoreDimension[] = [
  'pain',
  'willingnessToPay',
  'frequency',
  'market',
  'competition',
  'acquisition',
  'feasibility',
];

/** Creates a stable UUID from the workflow replay scope and provider draft identity. */
export function createOpportunityAggregateId(
  researchRunId: string,
  invocationKey: string,
  draftId: string,
): string {
  const identity = [
    nonEmpty(researchRunId, 'researchRunId'),
    nonEmpty(invocationKey, 'invocationKey'),
    'opportunity',
    nonEmpty(draftId, 'draftId'),
  ].join('\u0000');
  const hex = createHash('sha256').update(identity, 'utf8').digest('hex').slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

export function parseOpportunityAnalysisPlan(value: unknown): OpportunityAnalysisPlan {
  const root = exactRecord(value, ['opportunities'], 'opportunity analysis plan');
  return {
    opportunities: unknownArray(root.opportunities, 'opportunities').map((item, index) =>
      parseOpportunityDraft(item, index)),
  };
}

/**
 * Validates Finding references and calculates every score deterministically.
 * Evidence references are derived from accepted Findings rather than model output.
 */
export function scoreOpportunityAnalysisPlan(
  plan: OpportunityAnalysisPlan,
  input: OpportunityAnalysisPlanInput,
): readonly ScoredOpportunityProposal[] {
  const findingById = new Map<string, OpportunityAnalysisFindingInput>();
  for (const finding of input.findings) {
    const findingId = nonEmpty(finding.findingId, 'finding input id');
    if (findingById.has(findingId)) {
      throw new InvalidOpportunityAnalysisPlanError(`Duplicate Finding input: ${findingId}`);
    }
    findingById.set(findingId, finding);
  }
  const draftIds = new Set<string>();

  return plan.opportunities.map((draft) => {
    const draftId = nonEmpty(draft.id, 'opportunity draft id');
    if (draftIds.has(draftId)) {
      throw new InvalidOpportunityAnalysisPlanError(`Duplicate Opportunity draft id: ${draftId}`);
    }
    draftIds.add(draftId);
    const findingIds = uniqueNonEmpty(draft.findingIds, `Opportunity ${draftId} findingIds`);
    const evidenceIds: EvidenceId[] = [];
    for (const findingId of findingIds) {
      const finding = findingById.get(findingId);
      if (finding === undefined) {
        throw new InvalidOpportunityAnalysisPlanError(
          `Opportunity ${draftId} references unknown Finding: ${findingId}`,
        );
      }
      if (finding.qualityStatus !== 'sufficient' || finding.requiresHumanReview) {
        throw new InvalidOpportunityAnalysisPlanError(
          `Opportunity ${draftId} references Finding ${findingId} without sufficient quality`,
        );
      }
      evidenceIds.push(...finding.evidenceIds);
    }
    const uniqueEvidenceIds = [...new Set(evidenceIds)];
    if (uniqueEvidenceIds.length === 0) {
      throw new InvalidOpportunityAnalysisPlanError(
        `Opportunity ${draftId} must resolve to at least one Evidence reference`,
      );
    }

    const scoreInput = scoreValueInput(draft.scoreFactors);
    return {
      draftId,
      researchRunId: input.researchRunId,
      findingIds,
      evidenceIds: uniqueEvidenceIds,
      title: nonEmpty(draft.title, `Opportunity ${draftId} title`),
      targetCustomer: nonEmpty(draft.targetCustomer, `Opportunity ${draftId} targetCustomer`),
      problem: nonEmpty(draft.problem, `Opportunity ${draftId} problem`),
      solution: nonEmpty(draft.solution, `Opportunity ${draftId} solution`),
      whyNow: nonEmpty(draft.whyNow, `Opportunity ${draftId} whyNow`),
      monetization: nonEmpty(draft.monetization, `Opportunity ${draftId} monetization`),
      mvp: nonEmpty(draft.mvp, `Opportunity ${draftId} mvp`),
      confidence: boundedScore(draft.confidence, `Opportunity ${draftId} confidence`),
      score: calculateOpportunityScore(scoreInput),
      scoreReasoning: scoreReasoning(draft.scoreFactors),
    };
  });
}

function parseOpportunityDraft(value: unknown, index: number): OpportunityDraft {
  const field = `opportunities[${index}]`;
  const record = exactRecord(value, [
    'id',
    'findingIds',
    'title',
    'targetCustomer',
    'problem',
    'solution',
    'whyNow',
    'monetization',
    'mvp',
    'confidence',
    'scoreFactors',
  ], field);
  return {
    id: unknownString(record.id, `${field}.id`),
    findingIds: unknownArray(record.findingIds, `${field}.findingIds`).map((item, itemIndex) =>
      unknownString(item, `${field}.findingIds[${itemIndex}]`)),
    title: unknownString(record.title, `${field}.title`),
    targetCustomer: unknownString(record.targetCustomer, `${field}.targetCustomer`),
    problem: unknownString(record.problem, `${field}.problem`),
    solution: unknownString(record.solution, `${field}.solution`),
    whyNow: unknownString(record.whyNow, `${field}.whyNow`),
    monetization: unknownString(record.monetization, `${field}.monetization`),
    mvp: unknownString(record.mvp, `${field}.mvp`),
    confidence: unknownNumber(record.confidence, `${field}.confidence`),
    scoreFactors: parseScoreFactors(record.scoreFactors, `${field}.scoreFactors`),
  };
}

function parseScoreFactors(value: unknown, field: string): OpportunityScoreFactorsDraft {
  const record = exactRecord(value, scoreDimensions, field);
  return {
    pain: parseScoreFactor(record.pain, `${field}.pain`),
    willingnessToPay: parseScoreFactor(record.willingnessToPay, `${field}.willingnessToPay`),
    frequency: parseScoreFactor(record.frequency, `${field}.frequency`),
    market: parseScoreFactor(record.market, `${field}.market`),
    competition: parseScoreFactor(record.competition, `${field}.competition`),
    acquisition: parseScoreFactor(record.acquisition, `${field}.acquisition`),
    feasibility: parseScoreFactor(record.feasibility, `${field}.feasibility`),
  };
}

function parseScoreFactor(value: unknown, field: string): OpportunityScoreFactorDraft {
  const record = exactRecord(value, ['value', 'reasoning'], field);
  return {
    value: unknownNumber(record.value, `${field}.value`),
    reasoning: unknownString(record.reasoning, `${field}.reasoning`),
  };
}

function scoreValueInput(factors: OpportunityScoreFactorsDraft): OpportunityScoreInput {
  return {
    pain: boundedScore(factors.pain.value, 'pain score'),
    willingnessToPay: boundedScore(factors.willingnessToPay.value, 'willingnessToPay score'),
    frequency: boundedScore(factors.frequency.value, 'frequency score'),
    market: boundedScore(factors.market.value, 'market score'),
    competition: boundedScore(factors.competition.value, 'competition score'),
    acquisition: boundedScore(factors.acquisition.value, 'acquisition score'),
    feasibility: boundedScore(factors.feasibility.value, 'feasibility score'),
  };
}

function scoreReasoning(
  factors: OpportunityScoreFactorsDraft,
): OpportunityScoreReasoning {
  return {
    pain: nonEmpty(factors.pain.reasoning, 'pain reasoning'),
    willingnessToPay: nonEmpty(factors.willingnessToPay.reasoning, 'willingnessToPay reasoning'),
    frequency: nonEmpty(factors.frequency.reasoning, 'frequency reasoning'),
    market: nonEmpty(factors.market.reasoning, 'market reasoning'),
    competition: nonEmpty(factors.competition.reasoning, 'competition reasoning'),
    acquisition: nonEmpty(factors.acquisition.reasoning, 'acquisition reasoning'),
    feasibility: nonEmpty(factors.feasibility.reasoning, 'feasibility reasoning'),
  };
}

function boundedScore(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new InvalidOpportunityAnalysisPlanError(`${field} must be between 0 and 100`);
  }
  return value;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  field: string,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new InvalidOpportunityAnalysisPlanError(`${field} must be an object`);
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new InvalidOpportunityAnalysisPlanError(`${field} contains unknown field: ${key}`);
    }
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new InvalidOpportunityAnalysisPlanError(`${field} is missing required field: ${key}`);
    }
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknownArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new InvalidOpportunityAnalysisPlanError(`${field} must be an array`);
  return value;
}

function unknownString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new InvalidOpportunityAnalysisPlanError(`${field} must be a string`);
  }
  return nonEmpty(value, field);
}

function unknownNumber(value: unknown, field: string): number {
  if (typeof value !== 'number') {
    throw new InvalidOpportunityAnalysisPlanError(`${field} must be a number`);
  }
  return value;
}

function uniqueNonEmpty(values: readonly string[], field: string): readonly string[] {
  if (values.length === 0) {
    throw new InvalidOpportunityAnalysisPlanError(`${field} must contain at least one value`);
  }
  const normalized = values.map((value) => nonEmpty(value, field));
  if (new Set(normalized).size !== normalized.length) {
    throw new InvalidOpportunityAnalysisPlanError(`${field} must not contain duplicates`);
  }
  return normalized;
}

function nonEmpty(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidOpportunityAnalysisPlanError(`${field} must be a non-empty string`);
  }
  return value.trim();
}
