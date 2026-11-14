# ADR-007: Opportunity Submission and Idempotent Persistence

## Status

Accepted for V0.1-D3-F-B.

## Context

Opportunity analysis produces product decisions from quality-approved Findings. The runtime output is untrusted, workflow retries must not create duplicate Opportunities, and score explanations must remain available with the persisted score.

## Decision

- Opportunity analysis uses `AgentRuntimeReasoner` and a dedicated schema-validated `product_scout_submit_opportunities` Tool.
- The DSH adapter accepts only one successful submission Tool call and never parses the final prose response as product data.
- Synthesis and Opportunity analysis use separate DSH patches and reasoner instances so each operation exposes only its required submission Tool.
- Opportunity IDs are deterministic UUIDs derived from ResearchRun ID, workflow invocation key, and provider draft ID.
- Persistence uses `ensure` semantics: an identical replay returns the existing Opportunity; different content for the same ID raises an explicit conflict.
- Opportunity and OpportunityScore are written in one database transaction.
- Every score dimension persists its explanation in `opportunity_scores.reasoning`.
- Workflow cancellation targets both bounded reasoning request identities.

## Consequences

- Replaying one workflow invocation is idempotent while a different invocation remains a distinct Opportunity identity.
- Partial failure can be retried without silently overwriting an existing product decision.
- Existing score rows receive an explicit legacy placeholder during migration because their original explanations cannot be reconstructed.
- DSH remains behind the runtime-neutral reasoner boundary and stays pinned to the existing version.
- Report and ValidationPlan generation remain outside this decision.
