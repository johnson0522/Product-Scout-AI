import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, like, sql } from 'drizzle-orm';
import { createFinding } from '@product-scout/domain';
import { createClaim, createEvidence } from '@product-scout/evidence';

import {
  claimEvidenceRefs,
  claims,
  createDb,
  DrizzleClaimRepository,
  DrizzleEvidenceStoreRepository,
  DrizzleResearchFindingRepository,
  evidenceStore,
  projects,
  researchRuns,
  users,
} from '../src';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const authorized = process.env.PRODUCT_SCOUT_TEST_DATABASE === '1'
  && isDedicatedTestUrl(testDatabaseUrl);
const describeIntegration = authorized ? describe : describe.skip;

if (!authorized) {
  console.warn('BLOCKED: Claim/Finding PostgreSQL tests require the dedicated test database');
}

function isDedicatedTestUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'postgresql:'
      && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
      && parsed.port === '55432'
      && parsed.pathname === '/product_scout_test';
  } catch {
    return false;
  }
}

describeIntegration('Claim and Research Finding PostgreSQL integration', () => {
  const ownerId = randomUUID();
  const projectId = randomUUID();
  const runId = randomUUID();
  const otherRunId = randomUUID();
  const prefix = 'd1-' + Date.now() + '-';
  let database: ReturnType<typeof createDb>;
  let evidenceRepository: DrizzleEvidenceStoreRepository;
  let claimRepository: DrizzleClaimRepository;
  let findingRepository: DrizzleResearchFindingRepository;

  beforeAll(async () => {
    database = createDb(testDatabaseUrl);
    evidenceRepository = new DrizzleEvidenceStoreRepository(database.db);
    claimRepository = new DrizzleClaimRepository(database.db);
    findingRepository = new DrizzleResearchFindingRepository(database.db);

    const tableNames = await database.db.execute(sql.raw([
      'select',
      "to_regclass('public.claims') as claims,",
      "to_regclass('public.claim_evidence_refs') as claim_evidence_refs,",
      "to_regclass('public.research_findings') as research_findings,",
      "to_regclass('public.research_finding_claims') as research_finding_claims",
    ].join(' ')));
    expect(tableNames[0]).toMatchObject({
      claims: 'claims',
      claim_evidence_refs: 'claim_evidence_refs',
      research_findings: 'research_findings',
      research_finding_claims: 'research_finding_claims',
    });

    await database.db.insert(users).values({
      id: ownerId,
      email: prefix + 'owner@example.test',
      name: 'D1 integration owner',
    });
    await database.db.insert(projects).values({
      id: projectId,
      ownerId,
      name: 'D1 integration project',
    });
    await database.db.insert(researchRuns).values([
      { id: runId, projectId, goal: 'Validate claim traceability' },
      { id: otherRunId, projectId, goal: 'Validate run isolation' },
    ]);
  });

  afterAll(async () => {
    await database.client.unsafe(
      'delete from research_finding_claims where finding_id in (select id from research_findings where research_run_id in ($1, $2))',
      [runId, otherRunId],
    );
    await database.client.unsafe(
      'delete from research_findings where research_run_id in ($1, $2)',
      [runId, otherRunId],
    );
    await database.client.unsafe(
      'delete from claim_evidence_refs where claim_id in (select id from claims where research_run_id in ($1, $2))',
      [runId, otherRunId],
    );
    await database.client.unsafe(
      'delete from claims where research_run_id in ($1, $2)',
      [runId, otherRunId],
    );
    await database.db.delete(researchRuns).where(eq(researchRuns.projectId, projectId));
    await database.db.delete(evidenceStore).where(like(evidenceStore.id, prefix + '%'));
    await database.db.delete(projects).where(eq(projects.id, projectId));
    await database.db.delete(users).where(eq(users.id, ownerId));
    await database.client.end({ timeout: 5 });
  });

  it('round-trips Claim references in stable order with timestamptz semantics', async () => {
    const evidenceOne = evidence(prefix + 'evidence-1', 'https://example.test/source-1');
    const evidenceTwo = evidence(prefix + 'evidence-2', 'https://example.test/source-2');
    await evidenceRepository.create(evidenceOne);
    await evidenceRepository.create(evidenceTwo);
    const claim = createClaim({
      id: prefix + 'claim-1',
      researchRunId: runId,
      text: 'Teams repeatedly reconcile records by hand.',
      evidenceRefs: [{ evidenceId: evidenceTwo.id }, { evidenceId: evidenceOne.id }],
      createdAt: new Date('2026-10-19T03:04:05.678Z'),
    });

    await claimRepository.create(claim);

    await expect(claimRepository.getById(claim.id)).resolves.toEqual(claim);
    expect((await claimRepository.listByResearchRunId(runId)).map((item) => item.id))
      .toContain(claim.id);
  });

  it('rejects duplicate Claim IDs without overwriting the original aggregate', async () => {
    const stored = await claimRepository.getById(prefix + 'claim-1');
    expect(stored).not.toBeNull();
    await expect(claimRepository.create(createClaim({
      ...stored!,
      text: 'Replacement text must not overwrite the original.',
    }))).rejects.toBeDefined();
    await expect(claimRepository.getById(stored!.id)).resolves.toEqual(stored);
  });

  it('rolls back Claim creation when an Evidence foreign key is missing', async () => {
    const claim = createClaim({
      id: prefix + 'claim-missing-evidence',
      researchRunId: runId,
      text: 'This claim references missing evidence.',
      evidenceRefs: [{ evidenceId: prefix + 'missing-evidence' }],
      createdAt: new Date('2026-10-19T03:04:05.678Z'),
    });

    await expect(claimRepository.create(claim)).rejects.toBeDefined();
    await expect(claimRepository.getById(claim.id)).resolves.toBeNull();
  });

  it('round-trips a Finding and preserves Claim order and timestamp', async () => {
    const sourceClaim = await claimRepository.getById(prefix + 'claim-1');
    expect(sourceClaim).not.toBeNull();
    const secondClaim = createClaim({
      id: prefix + 'claim-2',
      researchRunId: runId,
      text: 'The workflow happens every week.',
      evidenceRefs: sourceClaim!.evidenceRefs,
      createdAt: new Date('2026-10-19T04:05:06.789Z'),
    });
    await claimRepository.create(secondClaim);
    const finding = createFinding({
      id: prefix + 'finding-1',
      researchRunId: runId,
      type: 'insight',
      title: 'Recurring reconciliation burden',
      description: 'The cited claims describe a repeated operational problem.',
      claimIds: [secondClaim.id, sourceClaim!.id],
      createdAt: new Date('2026-10-19T05:06:07.890Z'),
    });

    await findingRepository.create(finding);

    await expect(findingRepository.getById(finding.id)).resolves.toEqual(finding);
    expect((await findingRepository.listByResearchRunId(runId)).map((item) => item.id))
      .toContain(finding.id);
  });

  it('rolls back Finding creation when a Claim foreign key is missing', async () => {
    const finding = createFinding({
      id: prefix + 'finding-missing-claim',
      researchRunId: runId,
      type: 'risk',
      title: 'Missing support',
      description: 'This finding references a missing claim.',
      claimIds: [prefix + 'missing-claim'],
      createdAt: new Date('2026-10-19T05:06:07.890Z'),
    });

    await expect(findingRepository.create(finding)).rejects.toBeDefined();
    await expect(findingRepository.getById(finding.id)).resolves.toBeNull();
  });

  it('traces Finding to Claim, Evidence, and the original source URL', async () => {
    const finding = await findingRepository.getById(prefix + 'finding-1');
    expect(finding).not.toBeNull();
    const loadedClaims = await Promise.all(
      finding!.claimIds.map((claimId) => claimRepository.getById(claimId)),
    );
    const loadedEvidence = await Promise.all(
      loadedClaims.flatMap((claim) => claim?.evidenceRefs ?? [])
        .map((reference) => evidenceRepository.getById(reference.evidenceId)),
    );

    expect(loadedClaims.every((claim) => claim?.researchRunId === runId)).toBe(true);
    expect(loadedEvidence.map((item) => item?.source.url)).toContain(
      'https://example.test/source-1',
    );
  });

  it('retains the legacy evidence table and C2 evidence_store semantics', async () => {
    const tables = await database.db.execute(sql.raw([
      'select',
      "to_regclass('public.evidence') as legacy_evidence,",
      "to_regclass('public.evidence_store') as evidence_store",
    ].join(' ')));
    expect(tables[0]).toMatchObject({
      legacy_evidence: 'evidence',
      evidence_store: 'evidence_store',
    });
  });

  it('does not silently repair invalid persisted Claim aggregates', async () => {
    const claimId = prefix + 'invalid-claim';
    await database.db.insert(claims).values({
      id: claimId,
      researchRunId: otherRunId,
      text: '',
      createdAt: new Date('2026-10-19T00:00:00.000Z'),
    });
    await database.db.insert(claimEvidenceRefs).values({
      claimId,
      evidenceId: prefix + 'evidence-1',
      position: 0,
    });

    await expect(claimRepository.getById(claimId)).rejects.toThrow(
      'text must be a non-empty string',
    );
  });
});

function evidence(id: string, url: string) {
  return createEvidence({
    id,
    source: { url },
    title: 'D1 integration evidence',
    excerpt: 'Evidence supporting a research claim.',
    retrievedAt: new Date('2026-10-19T02:03:04.567Z'),
  });
}
