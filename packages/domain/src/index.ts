/** Stable, persistence-agnostic domain contracts for Product Scout. */

export type UserId = string;
export type ProjectId = string;
export type ResearchRunId = string;
export type ResearchStepId = string;
export type SourceId = string;
export type EvidenceId = string;
export type ClaimId = string;
export type FindingId = string;
export type OpportunityId = string;
export type ResearchReportId = string;
export type ValidationPlanId = string;

export type ProjectStatus = 'active' | 'completed' | 'archived';

export type ResearchRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ResearchStepType =
  | 'market_understanding'
  | 'pain_point_research'
  | 'competitor_research'
  | 'market_signal_research'
  | 'opportunity_analysis'
  | 'report_generation';

export type ResearchStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface User {
  readonly id: UserId;
  readonly email: string;
  readonly name: string;
  readonly createdAt: Date;
}

export interface Project {
  readonly id: ProjectId;
  readonly ownerId: UserId;
  readonly name: string;
  readonly description?: string;
  readonly status: ProjectStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ResearchConstraints {
  readonly market?: string;
  readonly priceRange?: string;
  readonly competition?: 'low' | 'medium' | 'high' | 'any';
  readonly additional?: Readonly<Record<string, string>>;
}

export interface ResearchRun {
  readonly id: ResearchRunId;
  readonly projectId: ProjectId;
  readonly goal: string;
  readonly constraints?: ResearchConstraints;
  readonly status: ResearchRunStatus;
  readonly agentSessionId: string | null;
  readonly runtimeMetadata: Readonly<Record<string, string>> | null;
  readonly steps: readonly ResearchStep[];
  readonly createdAt: Date;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly errorMessage?: string;
}

export interface ProductEventBase {
  readonly eventId: string;
  readonly researchRunId: ResearchRunId;
  readonly occurredAt: Date;
}

export type ProductEvent =
  | (ProductEventBase & { readonly type: 'research.started' })
  | (ProductEventBase & {
      readonly type: 'research.step.started';
      readonly stepId: ResearchStepId;
      readonly stepType: ResearchStepType;
    })
  | (ProductEventBase & {
      readonly type: 'research.tool.started';
      readonly toolInvocationId: string;
      readonly toolName: string;
    })
  | (ProductEventBase & {
      readonly type: 'research.tool.completed';
      readonly toolInvocationId: string;
      readonly toolName: string;
      readonly success: boolean;
      readonly errorMessage?: string;
    })
  | (ProductEventBase & {
      readonly type: 'research.evidence.created';
      readonly evidenceId: EvidenceId;
      readonly sourceId: SourceId;
    })
  | (ProductEventBase & {
      readonly type: 'research.step.completed';
      readonly stepId: ResearchStepId;
      readonly stepType: ResearchStepType;
      readonly success: boolean;
      readonly errorMessage?: string;
    })
  | (ProductEventBase & {
      readonly type: 'research.opportunity.created';
      readonly opportunityId: OpportunityId;
    })
  | (ProductEventBase & { readonly type: 'research.completed' })
  | (ProductEventBase & { readonly type: 'research.cancelled' })
  | (ProductEventBase & {
      readonly type: 'research.failed';
      readonly errorMessage: string;
      readonly recoverable: boolean;
    });

export class AgentSessionBindingConflictError extends Error {
  public constructor(
    public readonly researchRunId: ResearchRunId,
    public readonly existingSessionId: string,
    public readonly requestedSessionId: string,
  ) {
    super(
      `Research run ${researchRunId} is already bound to agent session ${existingSessionId}`,
    );
    this.name = 'AgentSessionBindingConflictError';
  }
}

/** @deprecated Use ResearchRun for new code. */
export type Research = ResearchRun;

export interface ResearchResult {
  readonly summary: string;
  readonly findings: readonly Finding[];
  readonly confidence: number;
}

export interface Finding {
  readonly id: FindingId;
  readonly researchRunId: ResearchRunId;
  readonly type: 'opportunity' | 'risk' | 'insight';
  readonly title: string;
  readonly description: string;
  readonly claimIds: readonly ClaimId[];
  readonly createdAt: Date;
}

export interface CreateFindingInput {
  readonly id: FindingId;
  readonly researchRunId: ResearchRunId;
  readonly type: Finding['type'];
  readonly title: string;
  readonly description: string;
  readonly claimIds: readonly ClaimId[];
  readonly createdAt: Date;
}

export class InvalidFindingError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidFindingError';
  }
}

export function createFinding(input: CreateFindingInput): Finding {
  const id = requireFindingText(input.id, 'id');
  const researchRunId = requireFindingText(input.researchRunId, 'researchRunId');
  const title = requireFindingText(input.title, 'title');
  const description = requireFindingText(input.description, 'description');
  if (input.claimIds.length === 0) {
    throw new InvalidFindingError('claimIds must contain at least one ClaimId');
  }

  const claimIds = input.claimIds.map((claimId) =>
    requireFindingText(claimId, 'claimId'));
  if (new Set(claimIds).size !== claimIds.length) {
    throw new InvalidFindingError('claimIds must not contain duplicate ClaimIds');
  }
  if (!(input.createdAt instanceof Date) || Number.isNaN(input.createdAt.getTime())) {
    throw new InvalidFindingError('createdAt must be a valid Date');
  }

  return {
    id,
    researchRunId,
    type: input.type,
    title,
    description,
    claimIds,
    createdAt: new Date(input.createdAt.getTime()),
  };
}

function requireFindingText(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidFindingError(field + ' must be a non-empty string');
  }
  return value.trim();
}

export interface ResearchStepBase {
  readonly id: ResearchStepId;
  readonly researchRunId: ResearchRunId;
  readonly status: ResearchStepStatus;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly errorMessage?: string;
}

export interface MarketUnderstandingStep extends ResearchStepBase {
  readonly type: 'market_understanding';
}

export interface PainPointResearchStep extends ResearchStepBase {
  readonly type: 'pain_point_research';
}

export interface CompetitorResearchStep extends ResearchStepBase {
  readonly type: 'competitor_research';
}

export interface MarketSignalResearchStep extends ResearchStepBase {
  readonly type: 'market_signal_research';
}

export interface OpportunityAnalysisStep extends ResearchStepBase {
  readonly type: 'opportunity_analysis';
}

export interface ReportGenerationStep extends ResearchStepBase {
  readonly type: 'report_generation';
}

export type ResearchStep =
  | MarketUnderstandingStep
  | PainPointResearchStep
  | CompetitorResearchStep
  | MarketSignalResearchStep
  | OpportunityAnalysisStep
  | ReportGenerationStep;

export type SourceType = 'web' | 'document' | 'community' | 'other';

export interface Source {
  readonly id: SourceId;
  readonly type: SourceType;
  readonly url: string;
  readonly title?: string;
  readonly publisher?: string;
  readonly publishedAt?: Date;
  readonly retrievedAt: Date;
}

export interface Evidence {
  readonly id: EvidenceId;
  readonly researchRunId: ResearchRunId;
  readonly sourceId: SourceId;
  readonly claim: string;
  readonly quote?: string;
  readonly context?: string;
  readonly relevanceScore: number;
  readonly confidenceScore: number;
  readonly createdAt: Date;
}

export type OpportunityConfidence = number;

export interface Opportunity {
  readonly id: OpportunityId;
  readonly researchRunId: ResearchRunId;
  readonly title: string;
  readonly targetCustomer: string;
  readonly problem: string;
  readonly evidenceIds: readonly EvidenceId[];
  readonly solution: string;
  readonly whyNow: string;
  readonly monetization: string;
  readonly mvp: string;
  readonly score: OpportunityScore;
  readonly scoreReasoning: OpportunityScoreReasoning;
  readonly confidence: OpportunityConfidence;
}

export type OpportunityScoreDimension =
  | 'pain'
  | 'willingnessToPay'
  | 'frequency'
  | 'market'
  | 'competition'
  | 'acquisition'
  | 'feasibility';

export type OpportunityScoreInput = Readonly<
  Record<OpportunityScoreDimension, number>
>;

export type OpportunityScoreReasoning = Readonly<
  Record<OpportunityScoreDimension, string>
>;

export interface OpportunityScoreComponent {
  readonly value: number;
  readonly weight: number;
  readonly contribution: number;
}

export type OpportunityScoreBreakdown = Readonly<
  Record<OpportunityScoreDimension, OpportunityScoreComponent>
>;

export interface OpportunityScore {
  readonly total: number;
  readonly breakdown: OpportunityScoreBreakdown;
}

export interface ResearchReportSection {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly findingIds: readonly FindingId[];
  readonly opportunityIds: readonly OpportunityId[];
}

export interface ResearchReport {
  readonly id: ResearchReportId;
  readonly researchRunId: ResearchRunId;
  readonly title: string;
  readonly executiveSummary: string;
  readonly sections: readonly ResearchReportSection[];
  readonly limitations: readonly string[];
  readonly createdAt: Date;
}

export type CreateResearchReportInput = ResearchReport;

export class InvalidResearchReportError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidResearchReportError';
  }
}

export function createResearchReport(input: CreateResearchReportInput): ResearchReport {
  const sectionIds = new Set<string>();
  if (input.sections.length === 0) {
    throw new InvalidResearchReportError('sections must contain at least one section');
  }
  const sections = input.sections.map((section, index) => {
    const id = requireReportText(section.id, `sections[${index}].id`);
    if (sectionIds.has(id)) {
      throw new InvalidResearchReportError(`sections contains duplicate id: ${id}`);
    }
    sectionIds.add(id);
    const findingIds = uniqueReportReferences(
      section.findingIds,
      `sections[${index}].findingIds`,
    );
    const opportunityIds = uniqueReportReferences(
      section.opportunityIds,
      `sections[${index}].opportunityIds`,
    );
    if (findingIds.length === 0 && opportunityIds.length === 0) {
      throw new InvalidResearchReportError(
        `sections[${index}] must reference at least one Finding or Opportunity`,
      );
    }
    return {
      id,
      title: requireReportText(section.title, `sections[${index}].title`),
      content: requireReportText(section.content, `sections[${index}].content`),
      findingIds,
      opportunityIds,
    };
  });
  if (!(input.createdAt instanceof Date) || Number.isNaN(input.createdAt.getTime())) {
    throw new InvalidResearchReportError('createdAt must be a valid Date');
  }
  return {
    id: requireReportText(input.id, 'id'),
    researchRunId: requireReportText(input.researchRunId, 'researchRunId'),
    title: requireReportText(input.title, 'title'),
    executiveSummary: requireReportText(input.executiveSummary, 'executiveSummary'),
    sections,
    limitations: input.limitations.map((value, index) =>
      requireReportText(value, `limitations[${index}]`)),
    createdAt: new Date(input.createdAt.getTime()),
  };
}

function uniqueReportReferences(values: readonly string[], field: string): readonly string[] {
  const normalized = values.map((value) => requireReportText(value, field));
  if (new Set(normalized).size !== normalized.length) {
    throw new InvalidResearchReportError(`${field} must not contain duplicates`);
  }
  return normalized;
}

function requireReportText(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidResearchReportError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

export const OPPORTUNITY_SCORE_WEIGHTS: Readonly<
  Record<OpportunityScoreDimension, number>
> = {
  pain: 0.2,
  willingnessToPay: 0.2,
  frequency: 0.15,
  market: 0.15,
  competition: 0.1,
  acquisition: 0.1,
  feasibility: 0.1,
};

function validateScoreValue(
  dimension: OpportunityScoreDimension,
  value: number,
): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(
      `Score for ${dimension} must be a finite number between 0 and 100`,
    );
  }
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateOpportunityScore(
  input: OpportunityScoreInput,
): OpportunityScore {
  const component = (
    dimension: OpportunityScoreDimension,
    value: number,
  ): OpportunityScoreComponent => {
    validateScoreValue(dimension, value);
    const weight = OPPORTUNITY_SCORE_WEIGHTS[dimension];
    const contribution = roundScore(value * weight);
    return { value, weight, contribution };
  };

  const breakdown = {
    pain: component('pain', input.pain),
    willingnessToPay: component('willingnessToPay', input.willingnessToPay),
    frequency: component('frequency', input.frequency),
    market: component('market', input.market),
    competition: component('competition', input.competition),
    acquisition: component('acquisition', input.acquisition),
    feasibility: component('feasibility', input.feasibility),
  } satisfies OpportunityScoreBreakdown;
  const total = Object.values(breakdown).reduce(
    (sum, item) => sum + item.contribution,
    0,
  );

  return { total: roundScore(total), breakdown };
}

export type ValidationPlanDayNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface ValidationPlanDay {
  readonly day: ValidationPlanDayNumber;
  readonly objective: string;
  readonly activities: readonly string[];
  readonly successCriteria: readonly string[];
}

export interface ValidationPlan {
  readonly id: ValidationPlanId;
  readonly researchRunId: ResearchRunId;
  readonly days: readonly [
    ValidationPlanDay,
    ValidationPlanDay,
    ValidationPlanDay,
    ValidationPlanDay,
    ValidationPlanDay,
    ValidationPlanDay,
    ValidationPlanDay,
  ];
  readonly createdAt: Date;
}

export type CreateValidationPlanInput = ValidationPlan;

export class InvalidValidationPlanError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidValidationPlanError';
  }
}

export function createValidationPlan(input: CreateValidationPlanInput): ValidationPlan {
  if (input.days.length !== 7) {
    throw new InvalidValidationPlanError('days must contain exactly seven entries');
  }
  if (!(input.createdAt instanceof Date) || Number.isNaN(input.createdAt.getTime())) {
    throw new InvalidValidationPlanError('createdAt must be a valid Date');
  }
  return {
    id: requireValidationPlanText(input.id, 'id'),
    researchRunId: requireValidationPlanText(input.researchRunId, 'researchRunId'),
    days: [
      validationPlanDay(input.days[0], 1),
      validationPlanDay(input.days[1], 2),
      validationPlanDay(input.days[2], 3),
      validationPlanDay(input.days[3], 4),
      validationPlanDay(input.days[4], 5),
      validationPlanDay(input.days[5], 6),
      validationPlanDay(input.days[6], 7),
    ],
    createdAt: new Date(input.createdAt.getTime()),
  };
}

function validationPlanDay(
  value: ValidationPlanDay,
  expectedDay: ValidationPlanDayNumber,
): ValidationPlanDay {
  if (value.day !== expectedDay) {
    throw new InvalidValidationPlanError(
      `days must be ordered from 1 to 7; expected day ${expectedDay}`,
    );
  }
  if (value.activities.length === 0) {
    throw new InvalidValidationPlanError(`day ${expectedDay} activities must not be empty`);
  }
  if (value.successCriteria.length === 0) {
    throw new InvalidValidationPlanError(`day ${expectedDay} successCriteria must not be empty`);
  }
  return {
    day: expectedDay,
    objective: requireValidationPlanText(value.objective, `day ${expectedDay} objective`),
    activities: value.activities.map((activity, index) =>
      requireValidationPlanText(activity, `day ${expectedDay} activities[${index}]`)),
    successCriteria: value.successCriteria.map((criterion, index) =>
      requireValidationPlanText(criterion, `day ${expectedDay} successCriteria[${index}]`)),
  };
}

function requireValidationPlanText(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidValidationPlanError(`${field} must be a non-empty string`);
  }
  return value.trim();
}
