import { relations, sql } from 'drizzle-orm';
import type {
  OpportunityScoreBreakdown,
  ProductEvent,
  ResearchConstraints,
  ValidationPlanDay,
} from '@product-scout/domain';
import {
  check,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const projectStatusEnum = pgEnum('project_status', ['active', 'completed', 'archived']);
export const researchRunStatusEnum = pgEnum('research_run_status', [
  'pending', 'running', 'completed', 'failed', 'cancelled',
]);
export const researchStepTypeEnum = pgEnum('research_step_type', [
  'market_understanding', 'pain_point_research', 'competitor_research',
  'market_signal_research', 'opportunity_analysis', 'report_generation',
]);
export const researchStepStatusEnum = pgEnum('research_step_status', [
  'pending', 'running', 'completed', 'failed', 'cancelled',
]);
export const sourceTypeEnum = pgEnum('source_type', ['web', 'document', 'community', 'other']);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 320 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  status: projectStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const researchRuns = pgTable('research_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  goal: text('goal').notNull(),
  constraints: jsonb('constraints').$type<ResearchConstraints>(),
  status: researchRunStatusEnum('status').notNull().default('pending'),
  agentSessionId: varchar('agent_session_id', { length: 255 }),
  runtimeMetadata: jsonb('runtime_metadata').$type<Readonly<Record<string, string>>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  errorMessage: text('error_message'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const productEvents = pgTable('product_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  researchRunId: uuid('research_run_id').notNull().references(() => researchRuns.id, { onDelete: 'cascade' }),
  eventId: text('event_id').notNull(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  sequenceNumber: integer('sequence_number').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  payload: jsonb('payload').$type<ProductEvent>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  eventIdentityUnique: uniqueIndex('product_events_run_event_idx').on(table.researchRunId, table.eventId),
  eventSequenceUnique: uniqueIndex('product_events_run_sequence_idx').on(table.researchRunId, table.sequenceNumber),
}));

export const researchSteps = pgTable('research_steps', {
  id: uuid('id').defaultRandom().primaryKey(),
  researchRunId: uuid('research_run_id').notNull().references(() => researchRuns.id, { onDelete: 'cascade' }),
  type: researchStepTypeEnum('type').notNull(),
  status: researchStepStatusEnum('status').notNull().default('pending'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  runTypeUnique: uniqueIndex('research_steps_run_type_idx').on(table.researchRunId, table.type),
}));

export const sources = pgTable('sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  type: sourceTypeEnum('type').notNull(),
  url: text('url').notNull(),
  title: text('title'),
  publisher: varchar('publisher', { length: 255 }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  retrievedAt: timestamp('retrieved_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const evidence = pgTable('evidence', {
  id: uuid('id').defaultRandom().primaryKey(),
  researchRunId: uuid('research_run_id').notNull().references(() => researchRuns.id, { onDelete: 'cascade' }),
  sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'restrict' }),
  claim: text('claim').notNull(),
  quote: text('quote'),
  context: text('context'),
  relevanceScore: real('relevance_score').notNull(),
  confidenceScore: real('confidence_score').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  relevanceRange: check('evidence_relevance_score_range', sql`${table.relevanceScore} between 0 and 100`),
  confidenceRange: check('evidence_confidence_score_range', sql`${table.confidenceScore} between 0 and 100`),
}));

export const opportunities = pgTable('opportunities', {
  id: uuid('id').defaultRandom().primaryKey(),
  researchRunId: uuid('research_run_id').notNull().references(() => researchRuns.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  targetCustomer: text('target_customer').notNull(),
  problem: text('problem').notNull(),
  evidenceIds: jsonb('evidence_ids').$type<string[]>().notNull(),
  solution: text('solution').notNull(),
  whyNow: text('why_now').notNull(),
  monetization: text('monetization').notNull(),
  mvp: text('mvp').notNull(),
  confidence: real('confidence').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const opportunityScores = pgTable('opportunity_scores', {
  id: uuid('id').defaultRandom().primaryKey(),
  opportunityId: uuid('opportunity_id').notNull().references(() => opportunities.id, { onDelete: 'cascade' }),
  total: real('total').notNull(),
  breakdown: jsonb('breakdown').$type<OpportunityScoreBreakdown>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  opportunityUnique: uniqueIndex('opportunity_scores_opportunity_idx').on(table.opportunityId),
  totalRange: check('opportunity_scores_total_range', sql`${table.total} between 0 and 100`),
}));

export const validationPlans = pgTable('validation_plans', {
  id: uuid('id').defaultRandom().primaryKey(),
  researchRunId: uuid('research_run_id').notNull().references(() => researchRuns.id, { onDelete: 'cascade' }),
  days: jsonb('days').$type<ValidationPlanDay[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({ projects: many(projects) }));
export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, { fields: [projects.ownerId], references: [users.id] }),
  researchRuns: many(researchRuns),
}));
export const researchRunsRelations = relations(researchRuns, ({ one, many }) => ({
  project: one(projects, { fields: [researchRuns.projectId], references: [projects.id] }),
  steps: many(researchSteps), evidence: many(evidence), opportunities: many(opportunities), validationPlans: many(validationPlans), productEvents: many(productEvents),
}));
export const productEventsRelations = relations(productEvents, ({ one }) => ({
  researchRun: one(researchRuns, { fields: [productEvents.researchRunId], references: [researchRuns.id] }),
}));
export const researchStepsRelations = relations(researchSteps, ({ one }) => ({
  researchRun: one(researchRuns, { fields: [researchSteps.researchRunId], references: [researchRuns.id] }),
}));
export const sourcesRelations = relations(sources, ({ many }) => ({ evidence: many(evidence) }));
export const evidenceRelations = relations(evidence, ({ one }) => ({
  researchRun: one(researchRuns, { fields: [evidence.researchRunId], references: [researchRuns.id] }),
  source: one(sources, { fields: [evidence.sourceId], references: [sources.id] }),
}));
export const opportunitiesRelations = relations(opportunities, ({ one }) => ({
  researchRun: one(researchRuns, { fields: [opportunities.researchRunId], references: [researchRuns.id] }),
  score: one(opportunityScores),
}));
export const opportunityScoresRelations = relations(opportunityScores, ({ one }) => ({
  opportunity: one(opportunities, { fields: [opportunityScores.opportunityId], references: [opportunities.id] }),
}));
export const validationPlansRelations = relations(validationPlans, ({ one }) => ({
  researchRun: one(researchRuns, { fields: [validationPlans.researchRunId], references: [researchRuns.id] }),
}));
