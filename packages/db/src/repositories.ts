import type {
  Evidence,
  Opportunity,
  ProductEvent,
  Project,
  ResearchConstraints,
  ResearchRun,
  Source,
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

export interface OpportunityRepository {
  findById(id: Opportunity['id']): Promise<Opportunity | null>;
  listByResearchRunId(researchRunId: Opportunity['researchRunId']): Promise<readonly Opportunity[]>;
  create(input: OpportunityCreateInput): Promise<Opportunity>;
}
