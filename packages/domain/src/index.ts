/** Stable, persistence-agnostic domain contracts for Product Scout. */

export type UserId = string;
export type ProjectId = string;
export type ResearchRunId = string;
export type ResearchStepId = string;
export type SourceId = string;
export type EvidenceId = string;
export type OpportunityId = string;
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
  readonly steps: readonly ResearchStep[];
  readonly createdAt: Date;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly errorMessage?: string;
}

/** @deprecated Use ResearchRun for new code. */
export type Research = ResearchRun;

export interface ResearchResult {
  readonly summary: string;
  readonly findings: readonly Finding[];
  readonly confidence: number;
}

export interface Finding {
  readonly id: string;
  readonly type: 'opportunity' | 'risk' | 'insight';
  readonly title: string;
  readonly description: string;
  readonly evidence: readonly Evidence[];
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
