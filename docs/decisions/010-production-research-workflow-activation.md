# ADR-010: Production Research Workflow Gateway Activation

## Status

Accepted for V0.1-D3-G-A.

## Context

The complete application-owned Research Workflow now produces Evidence,
Findings, Quality Assessments, Opportunities, a ResearchReport, and a seven-day
ValidationPlan. The production Web Gateway still created the earlier DSH PoC
runtime, whose contract only demonstrated a test Tool and could not execute the
Product Scout workflow.

## Decision

- Keep `DefaultAgentGateway` and the `AgentRuntime` boundary unchanged.
- Replace only the production composition with
  `createProductionResearchWorkflowRuntimeFactory`.
- Construct all concrete DeepSeek Harness reasoners inside `apps/agent`; Web
  injects Search and Repository ports and does not import the DSH SDK.
- Use one isolated, schema-submitted reasoner for each of synthesis,
  opportunity analysis, report generation, and validation-plan generation.
- Keep DSH pinned to `0.2.1-alpha.1` and retain the four dedicated patches.
- Require an explicit `DSH_HOME`; DSH execution state remains outside
  PostgreSQL.
- Apply `AGENT_TIMEOUT_MS` as an overall workflow deadline and as the upper
  bound for each reasoning operation. A timeout cancels the Coordinator and
  active reasoners and produces a failed runtime result.
- The fixed workflow performs four searches. Reject a configured search budget
  below four and divide `AGENT_MAX_SOURCES` across those four steps.
- Preserve FakeRuntime and injected composition seams for tests. No test needs
  a real model or search provider.

## Consequences

- `POST /api/research` now enters the complete six-step workflow in production
  and reports completion only after Report and ValidationPlan persistence.
- Invalid production configuration fails explicitly; there is no fallback to
  mock search or the DSH PoC.
- Gateway event publication still occurs after `AgentRuntime.run()` returns.
  True incremental trajectory publication, durable ResearchStep state, and
  process-restart recovery remain separate work.
- Report, Evidence, and ValidationPlan presentation endpoints and UI remain
  outside this decision.
