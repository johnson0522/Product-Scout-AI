# ADR-006: Coordinator-Owned Workflow with a Narrow Runtime Reasoner

## Status

Accepted

## Context

D3-E-B introduced an explicit `ResearchSynthesisPlanProvider`, but no production
provider. DeepSeek Harness can execute an agent and tools, while its current
public `RunResult.finalResponse` remains free-form text. Parsing that prose as a
business result would create an unstable, weakly validated product boundary.

The installed DSH version is pinned to `0.2.1-alpha.1` and remains Developer
Preview. Its `sdk-minimal` profile also includes capabilities that are not
appropriate for evidence synthesis unless explicitly disabled.

## Decision

Product Scout keeps the Research Workflow Coordinator as the sole workflow
orchestrator. A narrow, runtime-neutral `AgentRuntimeReasoner` port performs one
bounded structured reasoning operation:

```text
ResearchWorkflowAnalysisHandler
        -> ResearchSynthesisPlanProvider
        -> AgentRuntimeReasoner
        -> DeepSeekHarnessReasoner
        -> product_scout_submit_synthesis
```

The DSH adapter accepts output only through one successful call to the
schema-validated `product_scout_submit_synthesis` tool. It pairs public
`tool/call` and `tool/result` events, parses the call arguments as unknown JSON,
and passes the value through Product Scout's strict structural and semantic
validators. Assistant prose is never treated as the synthesis result.

Each reasoning request owns an isolated DSH lifecycle, explicit `dshHome`,
bounded request timeout, and allowlisted child environment. Its patch disables
the persistent shell tools and MCP resources, and registers only the submission
tool. The tool acknowledges validated data but performs no persistence or other
external side effect.

## Consequences

- `packages/agent-sdk` does not depend on DSH, Cordis, databases, or Research types.
- The Coordinator retains step ordering, cancellation, persistence, replay, and
  quality-control responsibilities.
- DSH is replaceable behind `AgentRuntimeReasoner` and remains pinned in this phase.
- Structural tool validation is supplemented by a strict local parser and the
  existing Evidence/Claim reference validation.
- Default tests use a fake reasoner and fake Harness; they require no model API key.
- A live model smoke test is a separate environment-dependent validation and is
  not evidence that workflow persistence is correct.

The complete `product-scout-research-v0.1` workflow still requires
`report_generation`; a missing report therefore remains a failed ResearchRun.
The separately versioned `product-scout-analysis-v0.1` workflow ends at
`opportunity_analysis` and may complete after Finding and Quality artifacts are
produced. Its completion must not be presented as a completed report.

`ResearchWorkflowRuntime` adapts this application-owned Analysis Workflow to the
existing `AgentRuntime` session/run/cancel contract. This keeps AgentGateway
independent of Coordinator internals. Cancelling the runtime first marks the
Coordinator invocation and then cancels the matching reasoner request, using the
same ResearchRun and workflow invocation identity as synthesis creation.

## Rejected Alternatives

- Parsing `RunResult.finalResponse` as JSON.
- Giving DSH ownership of the research workflow or database writes.
- Exposing DSH session or event types through application contracts.
- Upgrading DSH as part of this integration.
