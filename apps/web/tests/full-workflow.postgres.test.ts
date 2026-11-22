import { DrizzleResearchQualitySnapshotRepository } from '@product-scout/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AgentJsonValue, AgentRuntimeReasoner } from '@product-scout/agent-sdk';
import { createResearchWorkflowRuntimeFactory } from '@product-scout/agent/workflow';
import {
  createDb, DrizzleClaimRepository, DrizzleEvidenceAcquisitionRepository, DrizzleEvidenceStoreRepository,
  DrizzleOpportunityRepository, DrizzleProductEventStore, DrizzleProjectRepository,
  DrizzleResearchFindingRepository, DrizzleResearchReportRepository, DrizzleResearchRunRepository,
  DrizzleResearchStepRepository, DrizzleSourceRepository, DrizzleValidationPlanRepository,
} from '@product-scout/db';
import { DefaultAgentGateway, InMemoryLiveEventPublisher, SearchTool, SourceResearchSearch } from '@product-scout/research';
import { ProductApi } from '../lib/product-api';
import type { WebResearchDependencies } from '../lib/agent-gateway';
import { GET as listProjects, POST as createProject } from '../app/api/projects/route';
import { POST as startResearch } from '../app/api/research/route';
import { GET as readRun } from '../app/api/research/[id]/route';
import { GET as readEvidence } from '../app/api/research/[id]/evidence/route';
import { GET as readReport } from '../app/api/research/[id]/report/route';
import { GET as readEvents } from '../app/api/research/[id]/events/route';

// Only the composition root is replaced. Route Handlers, Gateway, Coordinator,
// services, and repositories execute their real code against PostgreSQL.
const httpPorts = vi.hoisted(() => ({ api: undefined as ProductApi | undefined, dependencies: undefined as WebResearchDependencies | undefined }));
vi.mock('../lib/agent-gateway', () => ({
  getProductApi: () => httpPorts.api!,
  getAgentGateway: () => httpPorts.dependencies!.gateway,
  getResearchEventDependencies: () => httpPorts.dependencies!,
}));

function dedicated(value: string | undefined): boolean {
  try { const url = new URL(value ?? ''); return url.protocol === 'postgresql:' && ['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '55432' && url.pathname === '/product_scout_test'; } catch { return false; }
}
const authorized = process.env.PRODUCT_SCOUT_TEST_DATABASE === '1' && dedicated(process.env.TEST_DATABASE_URL);
if (!authorized) console.warn('BLOCKED: full workflow PostgreSQL test needs the dedicated test database');

(authorized ? describe : describe.skip)('full workflow with real PostgreSQL and injected fake research transports', () => {
  const ownerId = randomUUID();
  let database: ReturnType<typeof createDb>;
  let runId: string;
  const prefix = `acceptance-${ownerId}`;

  beforeAll(async () => {
    database = createDb(process.env.TEST_DATABASE_URL!);
    await database.client`insert into users (id, email, name) values (${ownerId}, ${`${ownerId}@acceptance.test`}, 'Acceptance')`;
  });
  afterAll(async () => {
    if (!database) return;
    // Delete only test-owned rows; leave unrelated rows and migration state intact.
    await database.client`delete from users where id = ${ownerId}`;
    await database.client`delete from evidence_store where id like ${`${prefix}%`}`;
    await database.client`delete from sources where url like ${`https://${prefix}-%`}`;
    await database.client.end({ timeout: 5 });
  });

  it('creates a project and completes all six steps, persists trace/results, and orders terminal events', async () => {
    const db = database.db;
    const projects = new DrizzleProjectRepository(db);
    const runs = new DrizzleResearchRunRepository(db);
    const acquisitions = new DrizzleEvidenceAcquisitionRepository(db);
    const evidence = new DrizzleEvidenceStoreRepository(db);
    const quality = new DrizzleResearchQualitySnapshotRepository(db);
    const claims = new DrizzleClaimRepository(db);
    const findings = new DrizzleResearchFindingRepository(db);
    const opportunities = new DrizzleOpportunityRepository(db);
    const reports = new DrizzleResearchReportRepository(db);
    const plans = new DrizzleValidationPlanRepository(db);
    const events = new DrizzleProductEventStore(db);
    let sequence = 0;
    const searchQueries: string[] = [];
    const reasoner = (output: () => Promise<AgentJsonValue>): AgentRuntimeReasoner => ({
      reason: async (input) => {
        expect(input.prompt).toContain('US operations');
        return { requestId: input.requestId, outputContract: input.outputContract, output: await output(), events: [] };
      },
      cancel: async () => {},
    });
    const factory = createResearchWorkflowRuntimeFactory({
      search: new SourceResearchSearch(new SearchTool({ search: async ({ query }) => {
        searchQueries.push(query);
        return { query, items: [{ title: 'Independent customer report', url: `https://${prefix}-${sequence + 1}.example/observation`, snippet: 'A recurring workflow observation.' }] };
      } }), {
        fetch: async ({ url }) => ({ url, text: 'Teams report recurring manual reconciliation work.', retrievedAt: new Date() }),
      }, new DrizzleSourceRepository(db)),
      qualityStore: quality, evidenceRepository: evidence, evidenceAcquisitionRepository: acquisitions, claimRepository: claims,
      findingRepository: findings, opportunityStore: opportunities, reportStore: reports, validationPlanStore: plans,
      evidenceIdGenerator: { generate: () => `${prefix}-${++sequence}` }, workflowTimeoutMs: 20_000,
      reasoner: reasoner(async () => {
        const ids = (await acquisitions.listByResearchRunId(runId)).map((item) => item.evidenceId);
        return {
          claims: [{ id: 'recurring', text: 'Teams report recurring reconciliation work.', evidenceIds: ids }],
          findings: [{ id: 'burden', type: 'insight', title: 'Recurring reconciliation work', description: 'Independent sources describe recurring work.', claimIds: ['recurring'] }],
          assessments: ids.map((evidenceId) => ({ claimId: 'recurring', evidenceId, relation: 'supports', semanticKind: 'user_report', sourceKind: 'independent_third_party' })),
        };
      }),
      opportunityReasoner: reasoner(async () => ({ opportunities: [{
        id: 'assistant', findingIds: (await findings.listByResearchRunId(runId)).map((item) => item.id),
        title: 'Reconciliation assistant', targetCustomer: 'Operations teams', problem: 'Recurring work', solution: 'Assisted reconciliation', whyNow: 'Growing complexity', monetization: 'Monthly subscription', mvp: 'Import and compare', confidence: 70,
        scoreFactors: Object.fromEntries(['pain', 'willingnessToPay', 'frequency', 'market', 'competition', 'acquisition', 'feasibility'].map((key) => [key, { value: 70, reasoning: 'A test fixture explanation tied to the supplied Findings.' }])),
      }] })),
      reportReasoner: reasoner(async () => ({ title: 'Acceptance report', executiveSummary: 'A focused opportunity warrants validation.', sections: [{ id: 'result', title: 'Research findings', content: 'Independent evidence describes repeated work.', findingIds: (await findings.listByResearchRunId(runId)).map((item) => item.id), opportunityIds: (await opportunities.listByResearchRunId(runId)).map((item) => item.id) }], limitations: ['Injected transports; no live-model quality claim.'] })),
      validationPlanReasoner: reasoner(async () => ({ days: Array.from({ length: 7 }, (_, index) => ({ day: index + 1, objective: 'Validate the supported opportunity', activities: ['Interview operations teams'], successCriteria: ['Document three concrete examples'] })) })),
    });
    const liveEventPublisher = new InMemoryLiveEventPublisher();
    const gateway = new DefaultAgentGateway(runs, factory, { eventStore: events, liveEventPublisher, stepStore: new DrizzleResearchStepRepository(db) });
    const api = new ProductApi({ projects, runs, acquisitions, evidence, claims, findings, quality, opportunities, reports, validationPlans: plans }, ownerId);
    httpPorts.api = api;
    httpPorts.dependencies = { gateway, runs, eventStore: events, liveEventPublisher };
    const created = await createProject(new Request('http://localhost/api/projects', {
      method: 'POST', body: JSON.stringify({ name: 'Acceptance workflow', ownerId: randomUUID() }),
    }), undefined);
    expect(created.status).toBe(201);
    const project = (await created.json()).project as { id: string; ownerId: string };
    expect(project.ownerId).toBe(ownerId);
    const started = await startResearch(new Request('http://localhost/api/research', {
      method: 'POST', body: JSON.stringify({ projectId: project.id, goal: 'Investigate operations workflows', constraints: { market: 'US operations' } }),
    }), undefined);
    expect(started.status).toBe(201);
    runId = (await started.json()).researchRunId as string;
    await vi.waitFor(async () => expect((await api.requireRun(runId)).status).toBe('completed'), { timeout: 15_000 });
    const stored = await api.requireRun(runId);
    expect(stored.status, stored.errorMessage).toBe('completed');
    expect(stored.goal).toBe('Investigate operations workflows');
    expect(searchQueries).toHaveLength(4);
    expect(searchQueries.every((query) => query.includes('US operations'))).toBe(true);
    expect(stored.steps).toHaveLength(6);
    expect(stored.steps.every((step) => step.status === 'completed')).toBe(true);
    const trace = await api.evidenceForRun(runId);
    expect(trace.evidence).toHaveLength(4);
    expect(trace.claims).toHaveLength(1);
    expect(trace.findings).toHaveLength(1);
    expect(trace.qualityAssessments).toHaveLength(1);
    expect(trace.qualityAssessments[0]).toMatchObject({
      researchRunId: runId, rulesVersion: 'rqc-v1',
      assessment: { status: 'sufficient', requiresHumanReview: false, issues: [] },
    });
    expect(trace.qualityAssessments[0]?.inputs).toHaveLength(4);
    expect(trace.claims[0]?.evidenceRefs.map((ref) => ref.evidenceId).sort()).toEqual(trace.evidence.map((item) => item.id).sort());
    const storedOpportunities = await opportunities.listByResearchRunId(runId);
    expect(storedOpportunities[0]?.score.total).toBe(70);
    expect(await reports.listByResearchRunId(runId)).toHaveLength(1);
    expect((await plans.listByResearchRunId(runId))[0]?.days).toHaveLength(7);
    const recorded = await events.listByResearchRunId(runId);
    expect(recorded.at(-1)?.type).toBe('research.completed');
    expect(recorded.filter((event) => event.type === 'research.evidence.created')).toHaveLength(4);
    expect(recorded.filter((event) => event.type === 'research.tool.completed')).toHaveLength(8);
    expect(new Set(recorded.map((event) => event.eventId)).size).toBe(recorded.length);
    const context = { params: { id: runId } };
    const read = await readRun(new Request(`http://localhost/api/research/${runId}`), context);
    const responseRun = (await read.json()).researchRun;
    expect(responseRun.status).toBe('completed');
    expect(responseRun).not.toHaveProperty('agentSessionId');
    expect((await (await listProjects(new Request('http://localhost/api/projects'), undefined)).json()).projects).toHaveLength(1);
    expect((await (await readEvidence(new Request(`http://localhost/api/research/${runId}/evidence`), context)).json()).evidence).toHaveLength(4);
    const responseReport = await (await readReport(new Request(`http://localhost/api/research/${runId}/report`), context)).json();
    expect(responseReport.reports).toHaveLength(1);
    expect(responseReport.validationPlans[0].days).toHaveLength(7);
    const stream = await readEvents(new Request(`http://localhost/api/research/${runId}/events`), context);
    const body = await stream.text();
    expect(body).toContain('event: research.completed');
    expect(body).toContain('event: research.tool.completed');
    expect((await listProjects(new Request('http://localhost/api/projects', { headers: { Origin: 'https://attacker.example' } }), undefined)).status).toBe(403);
  }, 30_000);
});
