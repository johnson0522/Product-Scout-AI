# Finding quality diagnostics

New workflows persist versioned assessments before attempting Opportunity
generation. Open a Research workspace and expand **Research quality** to see
the status, review requirement, triggered rules, Claim and Evidence links,
source URLs and the classifications used. Expand **All rule outcomes** for
passed and inapplicable checks. Only deterministic business diagnostics are
shown; hidden model reasoning is never exposed.

The existing owner-scoped endpoint returns:

```text
GET /api/research/:id/evidence
{ evidence, acquisitions, claims, findings, qualityAssessments }
```

Each snapshot contains `researchRunId`, `findingId`, `workflowInvocationKey`,
`rulesVersion`, `assessedAt`, `inputs`, and `assessment`. The inputs retain each
explicit Claim/Evidence relation, semantic classification and source kind.
The assessment includes Claim statuses, issues, seven rule outcomes per Claim,
supporting/contradicting/unclear references, source URLs and conflict candidates.
Responses preserve the existing local-origin and owner authorization boundary.
Storage errors return 503; they are never interpreted as an empty assessment.

## Local rollout

Stop the existing Web process before rebuilding. Verify the root `.env` points
to your intended local development database, then execute from the repo root:

```powershell
node --env-file=.env packages/db/scripts/migrate.mjs
pnpm build
pnpm --filter @product-scout/web start
```

This applies migration 0008 in addition to outstanding checked-in migrations.
The new migration adds only the snapshot table. It does not generate historical
quality records, retry failed research, or alter the report gate. A new research
run records new snapshots; earlier Findings explicitly show **No saved quality
assessment exists**. Do not mistake that message for approval or for a replay
of the previous model's classifications.

## Understanding review results

`needs_review` differs from `insufficient` and `conflicted`: the Claim may have
support but fail a review rule such as source diversity. `blocking: false`
does not authorize automatic reporting when `requiresHumanReview` is true.
The gate still requires `sufficient` and no human review.

In the examined historical run, the 20 Evidence records resolved to 11 URLs.
Most Claims had only one supporting URL; one provenance Claim used three
records of the same article. The five Findings recomputed as `needs_review`
using the verified original submission. That investigation was read-only and
was not saved as a historical assessment.

See [ADR-014](decisions/014-quality-assessment-snapshots.md) for the review of
rule applicability to attributed statements and research limitations. This
release keeps `rqc-v1` semantics and does not auto-approve those statements.

## Dedicated PostgreSQL verification

Use the existing [database safety gate](postgres-integration.md). The DB
integration suite includes snapshot round-trip and replay, changed-result
conflict, run ownership, foreign-key rejection, malformed JSON, query failure,
and separate invocations. The full workflow test also asserts quality snapshots
are written through the real application composition and read API.

## Executed verification (2026-11-22)

| Check | Result |
|---|---|
| pnpm typecheck | PASS; unchanged upstream packages may use Turbo cache |
| pnpm lint | PASS |
| pnpm test | PASS: 466 passed, 44 PostgreSQL cases skipped by default safety gate |
| pnpm build | PASS; existing Next ESLint-plugin advisory remains |
| pnpm db:test:up | PASS; dedicated service only |
| pnpm db:test:migrate | PASS; 0008 actually applied on dedicated PostgreSQL 16.15 |
| pnpm db:test:integration | PASS: DB 29 + Research 14 + Web 1 = 44 executed, zero failures |
| PLAYWRIGHT_CHANNEL=msedge pnpm test:e2e | PASS: 5 executed, zero failures |
| git diff --check | PASS |

New Evidence snapshot decoding tests (14), the workflow-write failure test and
owner-scoped API tests executed with fake ports; they are not PostgreSQL tests.
The five new DB snapshot cases executed separately and within the 44-case
dedicated suite. Do not add their repeated execution to the unique test count.
Browser checks use API fixtures; the real PostgreSQL full-workflow test uses
injected Search/Fetch/model transports. No live model or Search call was made
by this change. No development migration or historical backfill was performed.

An initial browser run exposed ambiguous test locators after adding a second
Finding heading/source link. Locators now target the original Finding/Evidence
anchors, and the complete five-case suite passed on rerun. Initial incremental
compile/lint failures were corrected before final checks.

Migration metadata verification confirmed that the 0008 snapshot points to
0007, adds only research_quality_snapshots, and changes no existing table or
enum. Historical SQL/snapshots remain untouched. No dependency was added.

## Changed files

Modified existing files:

- [apps/agent/src/workflow/createAnalysisWorkflowRuntimeFactory.ts](../apps/agent/src/workflow/createAnalysisWorkflowRuntimeFactory.ts)
- [apps/agent/tests/analysis-workflow-composition.test.ts](../apps/agent/tests/analysis-workflow-composition.test.ts)
- [apps/agent/tests/production-research-workflow-factory.test.ts](../apps/agent/tests/production-research-workflow-factory.test.ts)
- [apps/web/components/ResearchResults.tsx](../apps/web/components/ResearchResults.tsx)
- [apps/web/lib/agent-gateway.ts](../apps/web/lib/agent-gateway.ts)
- [apps/web/lib/product-api.ts](../apps/web/lib/product-api.ts)
- [apps/web/lib/product-client.ts](../apps/web/lib/product-client.ts)
- [apps/web/tests/agent-gateway-composition.test.ts](../apps/web/tests/agent-gateway-composition.test.ts)
- [apps/web/tests/full-workflow.postgres.test.ts](../apps/web/tests/full-workflow.postgres.test.ts)
- [apps/web/tests/product-api.test.ts](../apps/web/tests/product-api.test.ts)
- [docs/architecture.md](../docs/architecture.md)
- [docs/database-setup.md](../docs/database-setup.md)
- [docs/v0.1.md](../docs/v0.1.md)
- [packages/db/drizzle/meta/_journal.json](../packages/db/drizzle/meta/_journal.json)
- [packages/db/package.json](../packages/db/package.json)
- [packages/db/src/index.ts](../packages/db/src/index.ts)
- [packages/db/src/schema.ts](../packages/db/src/schema.ts)
- [packages/evidence/src/index.ts](../packages/evidence/src/index.ts)
- [packages/research/src/research-quality.ts](../packages/research/src/research-quality.ts)
- [packages/research/src/research-workflow-analysis-handler.ts](../packages/research/src/research-workflow-analysis-handler.ts)
- [packages/research/src/research-workflow-testing.ts](../packages/research/src/research-workflow-testing.ts)
- [packages/research/tests/research-workflow-analysis-handler.test.ts](../packages/research/tests/research-workflow-analysis-handler.test.ts)
- [packages/research/tests/research-workflow-analysis.integration.test.ts](../packages/research/tests/research-workflow-analysis.integration.test.ts)
- [tests/e2e/workspace.spec.ts](../tests/e2e/workspace.spec.ts)

New files:

- [apps/web/components/QualityDiagnostics.tsx](../apps/web/components/QualityDiagnostics.tsx)
- [docs/decisions/014-quality-assessment-snapshots.md](../docs/decisions/014-quality-assessment-snapshots.md)
- [docs/research-quality-diagnostics.md](../docs/research-quality-diagnostics.md)
- [packages/db/drizzle/0008_hot_goliath.sql](../packages/db/drizzle/0008_hot_goliath.sql)
- [packages/db/drizzle/meta/0008_snapshot.json](../packages/db/drizzle/meta/0008_snapshot.json)
- [packages/db/src/drizzle-research-quality.ts](../packages/db/src/drizzle-research-quality.ts)
- [packages/db/tests/research-quality.integration.test.ts](../packages/db/tests/research-quality.integration.test.ts)
- [packages/evidence/src/research-quality-model.ts](../packages/evidence/src/research-quality-model.ts)
- [packages/evidence/src/research-quality-repository.ts](../packages/evidence/src/research-quality-repository.ts)
- [packages/evidence/src/research-quality-validation.ts](../packages/evidence/src/research-quality-validation.ts)
- [packages/evidence/tests/research-quality-snapshot.test.ts](../packages/evidence/tests/research-quality-snapshot.test.ts)
- [tests/fixtures/research-quality.ts](../tests/fixtures/research-quality.ts)
