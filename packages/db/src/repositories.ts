import type {
  Evidence,
  Opportunity,
  ProductEvent,
  Project,
  ResearchConstraints,
  ResearchRun,
  ResearchReport,
  ResearchStep,
  Source,
  ValidationPlan,
} from '@product-scout/domain';

export type ProjectCreateInput = Pick<Project, 'ownerId' | 'name'> & {
  readonly description?: Project['description'];
  readonly status?: Project['status'];
};

export type ProjectUpdateInput = Partial<
  Pick<Project, 'name' | 'description' | 'status'>
>;

export interface ProjectRepository {
  findById(id: Project['id']): Promise<Project | null>;
  listByOwnerId(ownerId: Project['ownerId']): Promise<readonly Project[]>;
  create(input: ProjectCreateInput): Promise<Project>;
  update(id: Project['id'], input: ProjectUpdateInput): Promise<Project | null>;
}

export type ResearchRunCreateInput = Pick<ResearchRun, 'projectId' | 'goal'> & {
  readonly constraints?: ResearchConstraints;
  readonly agentSessionId?: string;
  readonly runtimeMetadata?: Readonly<Record<string, string>>;
};

export type ResearchRunUpdateInput = Partial<
  Pick<ResearchRun, 'status' | 'startedAt' | 'completedAt' | 'errorMessage'>
>;

export interface ResearchRunRepository {
  findById(id: ResearchRun['id']): Promise<ResearchRun | null>;
  listByProjectId(projectId: ResearchRun['projectId']): Promise<readonly ResearchRun[]>;
  create(input: ResearchRunCreateInput): Promise<ResearchRun>;
  update(id: ResearchRun['id'], input: ResearchRunUpdateInput): Promise<ResearchRun | null>;
  bindAgentSession(
    id: ResearchRun['id'],
    agentSessionId: string,
    runtimeMetadata: Readonly<Record<string, string>>,
  ): Promise<ResearchRun>;
}

export interface ResearchStepProgressInput {
  readonly id: ResearchStep['id'];
  readonly researchRunId: ResearchStep['researchRunId'];
  readonly type: ResearchStep['type'];
  readonly status: Extract<ResearchStep['status'], 'running' | 'completed' | 'failed' | 'cancelled'>;
  readonly occurredAt: Date;
  readonly errorMessage?: string;
}

export interface ResearchStepRepository {
  findById(id: ResearchStep['id']): Promise<ResearchStep | null>;
  listByResearchRunId(
    researchRunId: ResearchStep['researchRunId'],
  ): Promise<readonly ResearchStep[]>;
  record(input: ResearchStepProgressInput): Promise<void>;
}

export interface ProductEventRepository {
  append(event: ProductEvent): Promise<void>;
  listByResearchRunId(
    researchRunId: ProductEvent['researchRunId'],
  ): Promise<readonly ProductEvent[]>;
}

export type SourceCreateInput = Pick<Source, 'type' | 'url' | 'retrievedAt'> & {
  readonly title?: Source['title'];
  readonly publisher?: Source['publisher'];
  readonly publishedAt?: Source['publishedAt'];
};

export interface SourceRepository {
  findById(id: Source['id']): Promise<Source | null>;
  findByUrl(url: Source['url']): Promise<Source | null>;
  create(input: SourceCreateInput): Promise<Source>;
}

export type EvidenceCreateInput = Pick<
  Evidence,
  | 'researchRunId'
  | 'sourceId'
  | 'claim'
  | 'relevanceScore'
  | 'confidenceScore'
> & {
  readonly quote?: Evidence['quote'];
  readonly context?: Evidence['context'];
};

export interface EvidenceRepository {
  findById(id: Evidence['id']): Promise<Evidence | null>;
  listByResearchRunId(researchRunId: Evidence['researchRunId']): Promise<readonly Evidence[]>;
  create(input: EvidenceCreateInput): Promise<Evidence>;
}

export type OpportunityCreateInput = Omit<Opportunity, 'id'>;

export class OpportunityPersistenceConflictError extends Error {
  public constructor(public readonly opportunityId: Opportunity['id']) {
    super(`Opportunity ${opportunityId} already exists with different content`);
    this.name = 'OpportunityPersistenceConflictError';
  }
}

export interface OpportunityRepository {
  findById(id: Opportunity['id']): Promise<Opportunity | null>;
  listByResearchRunId(researchRunId: Opportunity['researchRunId']): Promise<readonly Opportunity[]>;
  create(input: OpportunityCreateInput): Promise<Opportunity>;
  ensure(opportunity: Opportunity): Promise<Opportunity>;
}

export class ResearchReportPersistenceConflictError extends Error {
  public constructor(public readonly reportId: ResearchReport['id']) {
    super(`ResearchReport ${reportId} already exists with different content`);
    this.name = 'ResearchReportPersistenceConflictError';
  }
}

export interface ResearchReportRepository {
  findById(id: ResearchReport['id']): Promise<ResearchReport | null>;
  getById(id: ResearchReport['id']): Promise<ResearchReport | null>;
  listByResearchRunId(
    researchRunId: ResearchReport['researchRunId'],
  ): Promise<readonly ResearchReport[]>;
  ensure(report: ResearchReport): Promise<ResearchReport>;
}

export class ValidationPlanPersistenceConflictError extends Error {
  public constructor(public readonly validationPlanId: ValidationPlan['id']) {
    super(`ValidationPlan ${validationPlanId} already exists with different content`);
    this.name = 'ValidationPlanPersistenceConflictError';
  }
}

export interface ValidationPlanRepository {
  findById(id: ValidationPlan['id']): Promise<ValidationPlan | null>;
  getById(id: ValidationPlan['id']): Promise<ValidationPlan | null>;
  listByResearchRunId(
    researchRunId: ValidationPlan['researchRunId'],
  ): Promise<readonly ValidationPlan[]>;
  ensure(plan: ValidationPlan): Promise<ValidationPlan>;
}
