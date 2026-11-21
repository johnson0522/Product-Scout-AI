import { and, asc, eq, gt, isNull, max, sql } from 'drizzle-orm';
import {
  AgentSessionBindingConflictError,
  createResearchReport,
  createValidationPlan,
} from '@product-scout/domain';
import type {
  Evidence,
  Opportunity,
  OpportunityScore,
  ProductEvent,
  Project,
  ResearchRun,
  ResearchReport,
  ResearchStep,
  Source,
  ValidationPlan,
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
  ResearchStepProgressInput,
  ResearchStepRepository,
  ResearchReportRepository,
  SourceCreateInput,
  SourceRepository,
  ValidationPlanRepository,
} from './repositories';
import { OpportunityPersistenceConflictError } from './repositories';
import { ResearchReportPersistenceConflictError } from './repositories';
import { ValidationPlanPersistenceConflictError } from './repositories';
import type { Database } from './index';
import {
  evidence,
  opportunityScores,
  opportunities,
  projects,
  researchRuns,
  researchReports,
  researchSteps,
  productEvents,
  sources,
  validationPlans,
} from './schema';

type ProjectRow = typeof projects.$inferSelect;
type ResearchRunRow = typeof researchRuns.$inferSelect;
type ResearchStepRow = typeof researchSteps.$inferSelect;
type SourceRow = typeof sources.$inferSelect;
type EvidenceRow = typeof evidence.$inferSelect;
type OpportunityRow = typeof opportunities.$inferSelect;
type OpportunityScoreRow = typeof opportunityScores.$inferSelect;
type ResearchReportRow = typeof researchReports.$inferSelect;
type ValidationPlanRow = typeof validationPlans.$inferSelect;
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

function mapOpportunity(row: OpportunityRow, score: OpportunityScore, scoreReasoning: Opportunity['scoreReasoning']): Opportunity {
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
    scoreReasoning,
    confidence: row.confidence,
  };
}

function mapResearchReport(row: ResearchReportRow): ResearchReport {
  return createResearchReport({
    id: row.id,
    researchRunId: row.researchRunId,
    title: row.title,
    executiveSummary: row.executiveSummary,
    sections: row.sections,
    limitations: row.limitations,
    createdAt: row.createdAt,
  });
}

function mapValidationPlan(row: ValidationPlanRow): ValidationPlan {
  if (row.days.length !== 7) {
    throw new Error(`ValidationPlan ${row.id} does not contain seven days`);
  }
  return createValidationPlan({
    id: row.id,
    researchRunId: row.researchRunId,
    days: [
      row.days[0]!,
      row.days[1]!,
      row.days[2]!,
      row.days[3]!,
      row.days[4]!,
      row.days[5]!,
      row.days[6]!,
    ],
    createdAt: row.createdAt,
  });
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

export class DrizzleResearchStepRepository implements ResearchStepRepository {
  public constructor(private readonly db: Database) {}

  public async findById(id: ResearchStep['id']): Promise<ResearchStep | null> {
    const rows = await this.db.select().from(researchSteps)
      .where(eq(researchSteps.id, id)).limit(1);
    return rows[0] ? mapResearchStep(rows[0]) : null;
  }

  public async listByResearchRunId(
    researchRunId: ResearchStep['researchRunId'],
  ): Promise<readonly ResearchStep[]> {
    const rows = await this.db.select().from(researchSteps)
      .where(eq(researchSteps.researchRunId, researchRunId))
      .orderBy(asc(researchSteps.createdAt));
    return rows.map(mapResearchStep);
  }

  public async record(input: ResearchStepProgressInput): Promise<void> {
    const isRunning = input.status === 'running';
    await this.db.insert(researchSteps).values({
      id: input.id,
      researchRunId: input.researchRunId,
      type: input.type,
      status: input.status,
      startedAt: isRunning ? sql`${input.occurredAt.toISOString()}` : null,
      completedAt: isRunning ? null : sql`${input.occurredAt.toISOString()}`,
      errorMessage: input.errorMessage,
    }).onConflictDoUpdate({
      target: [researchSteps.researchRunId, researchSteps.type],
      set: {
        status: input.status,
        ...(isRunning
          ? {
              startedAt: sql`${input.occurredAt.toISOString()}`,
              completedAt: null,
              errorMessage: null,
            }
          : {
              completedAt: sql`${input.occurredAt.toISOString()}`,
              errorMessage: input.errorMessage ?? null,
            }),
        updatedAt: sql`now()`,
      },
    });
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
    return mapOpportunity(row, mapScore(score), score.reasoning);
  }

  public async findById(id: Opportunity['id']): Promise<Opportunity | null> {
    const rows = await this.db.select().from(opportunities).where(eq(opportunities.id, id)).limit(1);
    return rows[0] ? this.withScore(rows[0]) : null;
  }

  public async getById(id: Opportunity['id']): Promise<Opportunity | null> {
    return this.findById(id);
  }

  public async listByResearchRunId(researchRunId: Opportunity['researchRunId']): Promise<readonly Opportunity[]> {
    const rows = await this.db.select().from(opportunities).where(eq(opportunities.researchRunId, researchRunId));
    return Promise.all(rows.map((row) => this.withScore(row)));
  }

  public async create(input: OpportunityCreateInput): Promise<Opportunity> {
    return this.db.transaction(async (transaction) => {
      const rows = await transaction.insert(opportunities).values(opportunityValues(input)).returning();
      const opportunity = firstOrThrow(rows, 'opportunity');
      await transaction.insert(opportunityScores).values({
        opportunityId: opportunity.id,
        total: input.score.total,
        breakdown: input.score.breakdown,
        reasoning: input.scoreReasoning,
      });
      return mapOpportunity(opportunity, input.score, input.scoreReasoning);
    });
  }

  public async ensure(opportunity: Opportunity): Promise<Opportunity> {
    const existing = await this.findById(opportunity.id);
    if (existing !== null) return requireSameOpportunity(existing, opportunity);
    try {
      return await this.db.transaction(async (transaction) => {
        const rows = await transaction.insert(opportunities).values({
          id: opportunity.id,
          ...opportunityValues(opportunity),
        }).returning();
        const inserted = firstOrThrow(rows, 'opportunity');
        await transaction.insert(opportunityScores).values({
          opportunityId: inserted.id,
          total: opportunity.score.total,
          breakdown: opportunity.score.breakdown,
          reasoning: opportunity.scoreReasoning,
        });
        return mapOpportunity(inserted, opportunity.score, opportunity.scoreReasoning);
      });
    } catch (writeError: unknown) {
      const concurrent = await this.findById(opportunity.id);
      if (concurrent !== null) return requireSameOpportunity(concurrent, opportunity);
      throw writeError;
    }
  }
}

export class DrizzleResearchReportRepository implements ResearchReportRepository {
  public constructor(private readonly db: Database) {}

  public async findById(id: ResearchReport['id']): Promise<ResearchReport | null> {
    const rows = await this.db.select().from(researchReports)
      .where(eq(researchReports.id, id)).limit(1);
    return rows[0] ? mapResearchReport(rows[0]) : null;
  }

  public async getById(id: ResearchReport['id']): Promise<ResearchReport | null> {
    return this.findById(id);
  }

  public async listByResearchRunId(
    researchRunId: ResearchReport['researchRunId'],
  ): Promise<readonly ResearchReport[]> {
    const rows = await this.db.select().from(researchReports)
      .where(eq(researchReports.researchRunId, researchRunId));
    return rows.map(mapResearchReport);
  }

  public async ensure(report: ResearchReport): Promise<ResearchReport> {
    const existing = await this.findById(report.id);
    if (existing !== null) return requireSameResearchReport(existing, report);
    const existingForRun = await this.listByResearchRunId(report.researchRunId);
    if (existingForRun[0] !== undefined) {
      return requireSameResearchReport(existingForRun[0], report);
    }
    try {
      const rows = await this.db.insert(researchReports).values({
        id: report.id,
        researchRunId: report.researchRunId,
        title: report.title,
        executiveSummary: report.executiveSummary,
        sections: report.sections.map((section) => ({
          ...section,
          findingIds: [...section.findingIds],
          opportunityIds: [...section.opportunityIds],
        })),
        limitations: [...report.limitations],
        createdAt: sql`${report.createdAt.toISOString()}`,
      }).returning();
      return mapResearchReport(firstOrThrow(rows, 'research report'));
    } catch (writeError: unknown) {
      const concurrent = await this.findById(report.id);
      if (concurrent !== null) return requireSameResearchReport(concurrent, report);
      const concurrentForRun = await this.listByResearchRunId(report.researchRunId);
      if (concurrentForRun[0] !== undefined) {
        return requireSameResearchReport(concurrentForRun[0], report);
      }
      throw writeError;
    }
  }
}

export class DrizzleValidationPlanRepository implements ValidationPlanRepository {
  public constructor(private readonly db: Database) {}

  public async findById(id: ValidationPlan['id']): Promise<ValidationPlan | null> {
    const rows = await this.db.select().from(validationPlans)
      .where(eq(validationPlans.id, id)).limit(1);
    return rows[0] ? mapValidationPlan(rows[0]) : null;
  }

  public async getById(id: ValidationPlan['id']): Promise<ValidationPlan | null> {
    return this.findById(id);
  }

  public async listByResearchRunId(
    researchRunId: ValidationPlan['researchRunId'],
  ): Promise<readonly ValidationPlan[]> {
    const rows = await this.db.select().from(validationPlans)
      .where(eq(validationPlans.researchRunId, researchRunId));
    return rows.map(mapValidationPlan);
  }

  public async ensure(plan: ValidationPlan): Promise<ValidationPlan> {
    const existing = await this.findById(plan.id);
    if (existing !== null) return requireSameValidationPlan(existing, plan);
    const existingForRun = await this.listByResearchRunId(plan.researchRunId);
    if (existingForRun[0] !== undefined) {
      return requireSameValidationPlan(existingForRun[0], plan);
    }
    try {
      const rows = await this.db.insert(validationPlans).values({
        id: plan.id,
        researchRunId: plan.researchRunId,
        days: plan.days.map((day) => ({
          ...day,
          activities: [...day.activities],
          successCriteria: [...day.successCriteria],
        })),
        createdAt: sql`${plan.createdAt.toISOString()}`,
      }).returning();
      return mapValidationPlan(firstOrThrow(rows, 'validation plan'));
    } catch (writeError: unknown) {
      const concurrent = await this.findById(plan.id);
      if (concurrent !== null) return requireSameValidationPlan(concurrent, plan);
      const concurrentForRun = await this.listByResearchRunId(plan.researchRunId);
      if (concurrentForRun[0] !== undefined) {
        return requireSameValidationPlan(concurrentForRun[0], plan);
      }
      throw writeError;
    }
  }
}

function opportunityValues(input: OpportunityCreateInput | Opportunity) {
  return {
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
  };
}

function requireSameOpportunity(existing: Opportunity, requested: Opportunity): Opportunity {
  const dimensions = [
    'pain',
    'willingnessToPay',
    'frequency',
    'market',
    'competition',
    'acquisition',
    'feasibility',
  ] as const;
  const same = existing.id === requested.id
    && existing.researchRunId === requested.researchRunId
    && existing.title === requested.title
    && existing.targetCustomer === requested.targetCustomer
    && existing.problem === requested.problem
    && sameStrings(existing.evidenceIds, requested.evidenceIds)
    && existing.solution === requested.solution
    && existing.whyNow === requested.whyNow
    && existing.monetization === requested.monetization
    && existing.mvp === requested.mvp
    && existing.confidence === requested.confidence
    && existing.score.total === requested.score.total
    && dimensions.every((dimension) => {
      const left = existing.score.breakdown[dimension];
      const right = requested.score.breakdown[dimension];
      return left.value === right.value
        && left.weight === right.weight
        && left.contribution === right.contribution
        && existing.scoreReasoning[dimension] === requested.scoreReasoning[dimension];
    });
  if (!same) {
    throw new OpportunityPersistenceConflictError(requested.id);
  }
  return existing;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function requireSameResearchReport(
  existing: ResearchReport,
  requested: ResearchReport,
): ResearchReport {
  const same = existing.id === requested.id
    && existing.researchRunId === requested.researchRunId
    && existing.title === requested.title
    && existing.executiveSummary === requested.executiveSummary
    && sameStrings(existing.limitations, requested.limitations)
    && existing.sections.length === requested.sections.length
    && existing.sections.every((section, index) => {
      const other = requested.sections[index];
      return other !== undefined
        && section.id === other.id
        && section.title === other.title
        && section.content === other.content
        && sameStrings(section.findingIds, other.findingIds)
        && sameStrings(section.opportunityIds, other.opportunityIds);
    });
  if (!same) throw new ResearchReportPersistenceConflictError(requested.id);
  return existing;
}

function requireSameValidationPlan(
  existing: ValidationPlan,
  requested: ValidationPlan,
): ValidationPlan {
  const same = existing.id === requested.id
    && existing.researchRunId === requested.researchRunId
    && existing.days.every((day, index) => {
      const other = requested.days[index];
      return other !== undefined
        && day.day === other.day
        && day.objective === other.objective
        && sameStrings(day.activities, other.activities)
        && sameStrings(day.successCriteria, other.successCriteria);
    });
  if (!same) throw new ValidationPlanPersistenceConflictError(requested.id);
  return existing;
}
