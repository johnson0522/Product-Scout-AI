# ADR-011: Incremental Runtime Progress and Durable Research Steps

## Status

Accepted for V0.1-D3-G-B.

## Context

The production workflow introduced in D3-G-A returned its complete trajectory
only after all six steps finished. Product Events were durable and replayable,
but the Gateway published them in one batch. `research_steps` already existed
as business storage, yet no repository wrote workflow progress to it. A
synchronous `POST /api/research` also withheld the ResearchRun ID until the run
finished, preventing a client from subscribing to SSE during execution.

## Decision

- Add an optional asynchronous `AgentRunInput.onEvent` sink. It is an
  application-facing delivery boundary, not a DSH-specific callback.
- The application-owned Coordinator reports step lifecycle transitions to
  `ResearchWorkflowRuntime`; the runtime awaits event delivery before the next
  workflow action.
- Keep the complete trajectory for diagnostics and resume-compatible callers.
  The Gateway deduplicates incremental and final trajectory delivery by
  `eventId`.
- Persist step lifecycle as business state through a `ResearchStepProgressStore`
  port and `DrizzleResearchStepRepository`.
- Derive a stable UUID from ResearchRun and step type. Retries update the same
  business step instead of copying runtime attempts into PostgreSQL.
- `POST /api/research` creates the run, starts it in the current process, and
  immediately returns `201` with `researchRunId`. Subsequent failures are
  represented by ResearchRun state and durable Product Events.
- Keep the existing SSE durable replay plus process-local live publisher. Do
  not add WebSocket, a queue, or a worker.

## Consequences

- A client can subscribe after POST and receive/replay step progress while the
  workflow is executing.
- Product Event persistence failure remains a run failure; delivery is not
  best-effort.
- ResearchRun reads can expose started/completed/failed/cancelled business
  steps without storing hidden reasoning or the complete DSH trajectory.
- Execution remains process-local. A process exit can interrupt a run, and
  there is no automatic recovery or exactly-once execution guarantee.
- Search Tool and model Tool events are still limited by the adapters that
  forward them. This phase guarantees incremental agent and step lifecycle,
  not complete low-level DSH event mirroring.
