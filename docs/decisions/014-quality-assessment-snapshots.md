# ADR-014: Persist versioned Finding quality diagnostics

Status: Accepted

Date: 2026-11-22

## Context

The live run `2749489f-58b5-4051-b05a-5e36620dc9d9` produced 20 Evidence
records, 12 Claims and 5 Findings, but none qualified for automatic reporting.
Business persistence retained references without the explicit relation/source
classifications or deterministic quality result. Diagnosis required inspecting
a local DSH submission; the Product Layer must not read runtime trajectories.

## Decision

Store a business quality snapshot for each Finding, workflow invocation and
rules version. `rqc-v1` denotes the existing unchanged RQC-001–007 evaluation.
The snapshot contains the timestamp, explicit Claim/Evidence classifications,
complete deterministic assessment, rule outcomes, issues and source references.
It contains no model reasoning, prose transcript, credentials or DSH state.

Place data-only quality types and the Repository port in `packages/evidence`.
Keep the evaluator in `packages/research`, re-exporting its former public types
for compatibility. Drizzle implements the port in `packages/db`; the application
and Domain acquire no dependency on Drizzle or a runtime SDK.

`research_quality_snapshots` references `research_findings`; ResearchRun
ownership is derived through that Finding, avoiding a redundant run identifier.
The composite primary key is Finding/invocation/rules version. Identical replays
reuse the first timestamp. Changed inputs or results in that scope are errors,
never an overwrite. Different invocations remain separate snapshots. Writes
are awaited before quality artifacts or downstream Opportunities are accepted.
Write failure propagates as workflow failure; earlier saved business artifacts
are preserved. These writes are not a transaction for the entire workflow.

The owner-scoped existing Evidence read API returns `qualityAssessments`.
The UI displays status, human-review requirement, rule reasons, Claim/Evidence
links, source URLs, original classifications and all rule outcomes. Missing
historical snapshots are displayed as unrecorded, never as approved.

Historical runs are not silently recomputed or backfilled. Any future recovery
must verify the original structured inputs against persisted references, record
recovery provenance, and be an explicit operator operation. Product requests
never open runtime logs. There is no manual approval endpoint in this phase.

## Rule applicability review

Single-source and duplicate-source issues currently require review for *every*
Claim. Findings inherit the most restrictive Claim status. Even a non-blocking
issue prevents automatic reporting because the gate requires `sufficient` with
no human review. That gate stays unchanged.

This conservative policy also flags attributed statements ("source X reports
Y") and provenance limitations ("these records reuse one article"). A future
rule revision should explicitly distinguish market assertions, attribution and
methodological limitations. Do not infer these roles from keywords or exempt
an entire risk/insight Finding: those Findings can contain market assertions.
Any new role contract needs validation and a new rules version, plus tests
against laundering unsupported market assertions through a weaker role.

Different URLs do not prove independent sources; syndicated articles and
shared underlying datasets require examination. A future search improvement
should gather corroboration for a specific Claim from primary records and
official product documentation, within the existing search/time budgets.
The current phase neither broadens search nor invents corroboration.

## Consequences

Migration 0008 must be applied before running the new bundle. It creates one
table and leaves 0000–0007 intact. Existing runs remain readable with an empty
snapshot list. Default tests use explicit Fake ports; real persistence tests
use only the gated dedicated PostgreSQL database. Live model research is a
separate acceptance step.
