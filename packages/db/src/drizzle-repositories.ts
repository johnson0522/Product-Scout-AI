import { and, asc, eq, gt, isNull, max, sql } from 'drizzle-orm';
import {
  AgentSessionBindingConflictError,
} from '@product-scout/domain';
import type {
  Evidence,
  Opportunity,
  OpportunityScore,
  ProductEvent,
  Project,
  ResearchRun,
  ResearchStep,
  Source,
} from '@product-scout/domain';

import type {
  EvidenceCreateInput,
  EvidenceRepository,
  OpportunityCreateInput,
  OpportunityRepository,
  ProjectCreateInput,
  ProjectRepository,
  ProjectUpdateInput,
  ProductEventRepository,
  ResearchRunCreateInput,
  ResearchRunRepository,
  ResearchRunUpdateInput,
  SourceCreateInput,
  SourceRepository,
} from './repositories';
import type { Database } from './index';
import {
  evidence,
  opportunityScores,
  opportunities,
  projects,
  researchRuns,
  researchSteps,
  productEvents,
  sources,
} from './schema';

type ProjectRow = typeof projects.$inferSelect;
type ResearchRunRow = typeof researchRuns.$inferSelect;
type ResearchStepRow = typeof researchSteps.$inferSelect;
type SourceRow = typeof sources.$inferSelect;
type EvidenceRow = typeof evidence.$inferSelect;
type OpportunityRow = typeof opportunities.$inferSelect;
type OpportunityScoreRow = typeof opportunityScores.$inferSelect;
type ProductEventRow = typeof productEvents.$inferSelect;
type StoredProductEvent = ProductEvent & { readonly sequenceNumber: number };

function firstOrThrow<T>(rows: readonly T[], entity: string): T {
  const row = rows[0];
  if (!row) {
    throw new Error(`Insert did not return a ${entity}`);
  }
  return row;
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapResearchStep(row: ResearchStepRow): ResearchStep {
  const base = {
    id: row.id,
    researchRunId: row.researchRunId,
    status: row.status,
    startedAt: row.startedAt ?? undefined,
    completedAt: row.completedAt ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
  };

  switch (row.type) {
    case 'market_understanding':
      return { ...base, type: row.type };
    case 'pain_point_research':
      return { ...base, type: row.type };
    case 'competitor_research':
      return { ...base, type: row.type };
    case 'market_signal_research':
      return { ...base, type: row.type };
    case 'opportunity_analysis':
      return { ...base, type: row.type };
    case 'report_generation':
      return { ...base, type: row.type };
  }
}

function mapResearchRun(row: ResearchRunRow, steps: readonly ResearchStep[]): ResearchRun {
  return {
    id: row.id,
    projectId: row.projectId,
    goal: row.goal,
    constraints: row.constraints ?? undefined,
    status: row.status,
    agentSessionId: row.agentSessionId,
    runtimeMetadata: row.runtimeMetadata,
    steps,
    createdAt: row.createdAt,
    startedAt: row.startedAt ?? undefined,
    completedAt: row.completedAt ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
  };
}

function mapSource(row: SourceRow): Source {
  return {
    id: row.id,
    type: row.type,
    url: row.url,
    title: row.title ?? undefined,
    publisher: row.publisher ?? undefined,
    publishedAt: row.publishedAt ?? undefined,
    retrievedAt: row.retrievedAt,
  };
}

function mapEvidence(row: EvidenceRow): Evidence {
  return {
    id: row.id,
    researchRunId: row.researchRunId,
    sourceId: row.sourceId,
    claim: row.claim,
    quote: row.quote ?? undefined,
    context: row.context ?? undefined,
    relevanceScore: row.relevanceScore,
    confidenceScore: row.confidenceScore,
    createdAt: row.createdAt,
  };
}

function mapScore(row: OpportunityScoreRow): OpportunityScore {
  return {
    total: row.total,
    breakdown: row.breakdown,
  };
}

function mapOpportunity(row: OpportunityRow, score: OpportunityScore): Opportunity {
  return {
    id: row.id,
    researchRunId: row.researchRunId,
    title: row.title,
    targetCustomer: row.targetCustomer,
    problem: row.problem,
    evidenceIds: row.evidenceIds,
    solution: row.solution,
    whyNow: row.whyNow,
    monetization: row.monetization,
    mvp: row.mvp,
    score,
    confidence: row.confidence,
  };
}

export class DrizzleProjectRepository implements ProjectRepository {
  public constructor(private readonly db: Database) {}

  public async findById(id: Project['id']): Promise<Project | null> {
    const rows = await this.db.select().from(projects).where(eq(projects.id, id)).limit(1);
    return rows[0] ? mapProject(rows[0]) : null;
  }

  public async listByOwnerId(ownerId: Project['ownerId']): Promise<readonly Project[]> {
    const rows = await this.db.select().from(projects).where(eq(projects.ownerId, ownerId));
    return rows.map(mapProject);
  }

  public async create(input: ProjectCreateInput): Promise<Project> {
    const rows = await this.db.insert(projects).values(input).returning();
    return mapProject(firstOrThrow(rows, 'project'));
  }

  public async update(id: Project['id'], input: ProjectUpdateInput): Promise<Project | null> {
    const rows = await this.db.update(projects).set({ ...input, updatedAt: new Date() }).where(eq(projects.id, id)).returning();
    return rows[0] ? mapProject(rows[0]) : null;
  }
}

export class DrizzleResearchRunRepository implements ResearchRunRepository {
  public constructor(private readonly db: Database) {}

  private async withSteps(row: ResearchRunRow): Promise<ResearchRun> {
    const stepRows = await this.db.select().from(researchSteps).where(eq(researchSteps.researchRunId, row.id));
    return mapResearchRun(row, stepRows.map(mapResearchStep));
  }

  public async findById(id: ResearchRun['id']): Promise<ResearchRun | null> {
    const rows = await this.db.select().from(researchRuns).where(eq(researchRuns.id, id)).limit(1);
    return rows[0] ? this.withSteps(rows[0]) : null;
  }

  public async listByProjectId(projectId: ResearchRun['projectId']): Promise<readonly ResearchRun[]> {
    const rows = await this.db.select().from(researchRuns).where(eq(researchRuns.projectId, projectId));
    return Promise.all(rows.map((row) => this.withSteps(row)));
  }

  public async create(input: ResearchRunCreateInput): Promise<ResearchRun> {
    const rows = await this.db.insert(researchRuns).values({
      projectId: input.projectId,
      goal: input.goal,
      constraints: input.constraints,
      agentSessionId: input.agentSessionId,
      runtimeMetadata: input.runtimeMetadata,
    }).returning();
    return mapResearchRun(firstOrThrow(rows, 'research run'), []);
  }

  public async update(id: ResearchRun['id'], input: ResearchRunUpdateInput): Promise<ResearchRun | null> {
    const rows = await this.db.update(researchRuns).set({ ...input, updatedAt: new Date() }).where(eq(researchRuns.id, id)).returning();
    return rows[0] ? this.withSteps(rows[0]) : null;
  }

  public async bindAgentSession(
    id: ResearchRun['id'],
    agentSessionId: string,
    runtimeMetadata: Readonly<Record<string, string>>,
  ): Promise<ResearchRun> {
    const currentRows = await this.db.select().from(researchRuns).where(eq(researchRuns.id, id)).limit(1);
    const current = currentRows[0];
    if (!current) {
      throw new Error('Research run not found: ' + id);
    }
    if (current.agentSessionId !== null && current.agentSessionId !== agentSessionId) {
      throw new AgentSessionBindingConflictError(id, current.agentSessionId, agentSessionId);
    }
    if (current.agentSessionId === agentSessionId) {
      return this.withSteps(current);
    }
    const rows = await this.db.update(researchRuns)
      .set({ agentSessionId, runtimeMetadata, updatedAt: new Date() })
      .where(and(eq(researchRuns.id, id), isNull(researchRuns.agentSessionId)))
      .returning();
    if (rows[0]) {
      return this.withSteps(rows[0]);
    }

    const afterRows = await this.db.select().from(researchRuns)
      .where(eq(researchRuns.id, id))
      .limit(1);
    const after = afterRows[0];
    if (!after) {
      throw new Error('Research run not found: ' + id);
    }
    if (after.agentSessionId === agentSessionId) {
      return this.withSteps(after);
    }
    throw new AgentSessionBindingConflictError(id, after.agentSessionId ?? '', agentSessionId);
  }
}

export class DrizzleProductEventStore implements ProductEventRepository {
  public constructor(private readonly db: Database) {}

  public async append(event: ProductEvent): Promise<void> {
    await this.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${event.researchRunId}))`,
      );
      const existing = await transaction.select({ id: productEvents.id })
        .from(productEvents)
        .where(and(
          eq(productEvents.researchRunId, event.researchRunId),
          eq(productEvents.eventId, event.eventId),
        ))
        .limit(1);
      if (existing[0]) {
        return;
      }

      const sequenceRows = await transaction.select({ sequence: max(productEvents.sequenceNumber) })
        .from(productEvents)
        .where(eq(productEvents.researchRunId, event.researchRunId));
      const sequence = (sequenceRows[0]?.sequence ?? 0) + 1;
      await transaction.insert(productEvents).values({
        researchRunId: event.researchRunId,
        eventId: event.eventId,
        eventType: event.type,
        sequenceNumber: sequence,
        occurredAt: event.occurredAt,
        payload: event,
      });
    });
  }

  public async listByResearchRunId(
    researchRunId: ProductEvent['researchRunId'],
    afterSequenceNumber?: number,
  ): Promise<readonly StoredProductEvent[]> {
    const condition = afterSequenceNumber === undefined
      ? eq(productEvents.researchRunId, researchRunId)
      : and(
        eq(productEvents.researchRunId, researchRunId),
        gt(productEvents.sequenceNumber, afterSequenceNumber),
      );
    const rows: readonly ProductEventRow[] = await this.db.select()
      .from(productEvents)
      .where(condition)
      .orderBy(asc(productEvents.sequenceNumber));
    return rows.map((row) => ({
      ...row.payload,
      eventId: row.eventId,
      researchRunId: row.researchRunId,
      occurredAt: row.occurredAt,
      sequenceNumber: row.sequenceNumber,
    }));
  }
}

export { DrizzleProductEventStore as DrizzleProductEventRepository };

export class DrizzleSourceRepository implements SourceRepository {
  public constructor(private readonly db: Database) {}

  public async findById(id: Source['id']): Promise<Source | null> {
    const rows = await this.db.select().from(sources).where(eq(sources.id, id)).limit(1);
    return rows[0] ? mapSource(rows[0]) : null;
  }

  public async findByUrl(url: Source['url']): Promise<Source | null> {
    const rows = await this.db.select().from(sources).where(eq(sources.url, url)).limit(1);
    return rows[0] ? mapSource(rows[0]) : null;
  }

  public async create(input: SourceCreateInput): Promise<Source> {
    const rows = await this.db.insert(sources).values(input).returning();
    return mapSource(firstOrThrow(rows, 'source'));
  }
}

export class DrizzleEvidenceRepository implements EvidenceRepository {
  public constructor(private readonly db: Database) {}

  public async findById(id: Evidence['id']): Promise<Evidence | null> {
    const rows = await this.db.select().from(evidence).where(eq(evidence.id, id)).limit(1);
    return rows[0] ? mapEvidence(rows[0]) : null;
  }

  public async listByResearchRunId(researchRunId: Evidence['researchRunId']): Promise<readonly Evidence[]> {
    const rows = await this.db.select().from(evidence).where(eq(evidence.researchRunId, researchRunId));
    return rows.map(mapEvidence);
  }

  public async create(input: EvidenceCreateInput): Promise<Evidence> {
    const rows = await this.db.insert(evidence).values(input).returning();
    return mapEvidence(firstOrThrow(rows, 'evidence'));
  }
}

export class DrizzleOpportunityRepository implements OpportunityRepository {
  public constructor(private readonly db: Database) {}

  private async withScore(row: OpportunityRow): Promise<Opportunity> {
    const scoreRows = await this.db.select().from(opportunityScores).where(eq(opportunityScores.opportunityId, row.id)).limit(1);
    const score = scoreRows[0];
    if (!score) {
      throw new Error(`Opportunity ${row.id} has no score`);
    }
    return mapOpportunity(row, mapScore(score));
  }

  public async findById(id: Opportunity['id']): Promise<Opportunity | null> {
    const rows = await this.db.select().from(opportunities).where(eq(opportunities.id, id)).limit(1);
    return rows[0] ? this.withScore(rows[0]) : null;
  }

  public async listByResearchRunId(researchRunId: Opportunity['researchRunId']): Promise<readonly Opportunity[]> {
    const rows = await this.db.select().from(opportunities).where(eq(opportunities.researchRunId, researchRunId));
    return Promise.all(rows.map((row) => this.withScore(row)));
  }

  public async create(input: OpportunityCreateInput): Promise<Opportunity> {
    const rows = await this.db.insert(opportunities).values({
      researchRunId: input.researchRunId,
      title: input.title,
      targetCustomer: input.targetCustomer,
      problem: input.problem,
      evidenceIds: [...input.evidenceIds],
      solution: input.solution,
      whyNow: input.whyNow,
      monetization: input.monetization,
      mvp: input.mvp,
      confidence: input.confidence,
    }).returning();
    const opportunity = firstOrThrow(rows, 'opportunity');
    await this.db.insert(opportunityScores).values({
      opportunityId: opportunity.id,
      total: input.score.total,
      breakdown: input.score.breakdown,
    });
    return mapOpportunity(opportunity, input.score);
  }
}
