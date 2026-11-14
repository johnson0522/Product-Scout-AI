# ADR-009: Seven-day Validation Plan as a Report-generation Artifact

## Status

Accepted for V0.1-D3-F-D.

## Context

Product Scout V0.1 must produce a seven-day ValidationPlan. The existing fixed
workflow has six steps and intentionally ends with `report_generation`; project
architecture notes define that step as producing both Report and ValidationPlan.
The ValidationPlan domain and table existed, but had no runtime validation,
repository, generator, or workflow integration.

## Decision

- Keep the fixed six-step workflow; do not introduce a seventh step or new status enum.
- Treat Report and ValidationPlan as two separately persisted artifacts of `report_generation`.
- Require exactly seven ordered days, numbered 1 through 7. Every day has a non-empty objective, at least one activity, and at least one measurable success criterion.
- Generate the draft through `AgentRuntimeReasoner` and one successful schema-validated `product_scout_submit_validation_plan` call.
- Keep the Tool side-effect free. The application owns strict parsing, identity, and persistence.
- Derive a deterministic ValidationPlan UUID from ResearchRun and workflow invocation identity.
- Persist at most one ValidationPlan per ResearchRun using `ensure` semantics. Identical replay returns the first row; conflicting content or identity is rejected.
- Do not generate a ValidationPlan when opportunity analysis produced no persisted Opportunity.
- If Report persistence succeeds and ValidationPlan generation later fails, the step remains failed. A retry reuses the Report and resumes ValidationPlan generation.
- Use an isolated DSH patch and reasoner lifecycle; keep DSH pinned to the existing version.

## Consequences

- A completed full workflow now guarantees both a traceable Report and a persisted seven-day ValidationPlan.
- The five-step Analysis Workflow may still complete with no Opportunity and does not claim a Report or ValidationPlan.
- The original persisted `createdAt` is retained across replay and is not business-content conflict.
- ValidationPlan API/UI presentation and production Gateway activation remain separate work.
