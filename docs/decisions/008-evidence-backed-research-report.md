# ADR-008: Evidence-backed Research Report Generation

## Status

Accepted for V0.1-D3-F-C.

## Context

The default Product Scout workflow cannot complete without `report_generation`.
No ResearchReport domain or persistence contract previously existed, and free-form
assistant prose is not a safe business-data boundary.

## Decision

- Add a typed ResearchReport with structured sections, limitations, and explicit Finding and Opportunity references.
- Each section must reference an available quality-approved Finding or persisted Opportunity.
- Generate report content through `AgentRuntimeReasoner` and one successful schema-validated `product_scout_submit_report` call.
- Never parse final assistant prose as a ResearchReport and never expose hidden chain-of-thought.
- Keep the report Tool side-effect free; the application handler owns validation and persistence.
- Derive a deterministic report UUID from ResearchRun and workflow invocation identity.
- Persist one ResearchReport per ResearchRun with `ensure` semantics: identical replay returns the first row and conflicting content is rejected.
- Keep `product-scout-analysis-v0.1` unchanged and add full report generation only to `product-scout-research-v0.1` composition.
- Use a dedicated DSH patch and reasoner lifecycle for report generation; do not upgrade DSH.

## Consequences

- A completed full workflow now means a traceable report was persisted.
- The initial persisted `createdAt` is retained across identical replays and is not treated as business-content conflict.
- PostgreSQL owns report business data; DSH owns only bounded execution state.
- ValidationPlan generation, report presentation API/UI, and production Gateway switching remain outside this decision.
