

# Product Scout AI Architecture

## 1. Architecture Overview

Product Scout AI is divided into:

```text
Product Layer
      ↓
Agent Gateway
      ↓
Agent Runtime
      ↓
Skills
      ↓
Tools
      ↓
Infrastructure

```
## 2. Product Layer

Responsibilities:

- authentication
- project management
- research management
- report presentation
- validation plans
- business data
- API

Technology:

- Next.js
- React
- TypeScript
- Drizzle
  
## 3. Agent Gateway

The Agent Gateway connects the product system with the Agent Runtime.

Responsibilities:

- create research session
- start research
- resume research
- cancel research
- receive runtime events
- transform runtime events into product events

The gateway must not contain research methodology.

4. Agent Runtime

Initial implementation:
```Text
DeepSeekHarnessRuntime
```
It implements:
```TypeScript
interface AgentRuntime {
  createSession(
    input: CreateSessionInput
  ): Promise<AgentSession>;

  run(
    input: AgentRunInput
  ): Promise<AgentRunResult>;

  resume(
    sessionId: string
  ): Promise<AgentRunResult>;

  cancel(
    sessionId: string
  ): Promise<void>;

  getTrajectory(
    sessionId: string
  ): Promise<AgentTrajectory>;
}
```

The rest of the application only depends on this interface.

## 5. Skills

Skills contain domain methodology.

### Market Research

Responsibilities:
- understand target market
- identify market segments
- generate search queries
- collect evidence
- identify market signals

### Competitor Research

Responsibilities:
- identify competitors
- analyze positioning
- analyze pricing
- analyze features
- identify customer complaints
- identify market gaps

### Opportunity Analysis

Responsibilities:
- cluster pain points
- evaluate evidence
- analyze opportunity
- calculate score
- propose MVP
- propose validation plan

## 6. Tools

Initial tools:

```Text
web_search
web_fetch
source_store
evidence_store
```

Tools should be atomic.

V0.1-C1 establishes the replaceable search boundary:

```text
SearchTool -> SearchProvider -> MockSearchProvider -> SearchResult
```

SearchTool validates agent input and emits the existing tool lifecycle events.
The provider only returns raw search results; it does not create or persist
Evidence. The initial mock provider is deterministic and performs no network
requests.

E1 adds a real transport adapter without changing `SearchProvider`:

```text
readSearchConfig (packages/config)
        ↓
createSearchTool (apps/agent, server-side composition)
        ↓
SearchTool -> HttpSearchProvider -> Brave / Tavily HTTP search API
        ↓
SearchResultEvidenceIngestion -> EvidenceRepository
```

The HTTP adapter lives in `packages/research/src/search-providers`, accepts
explicit configuration and an injectable fetch transport, and does not read env,
persist evidence, or call DSH. Provider-specific request/response mapping is
separate from timeout, bounded streaming, and error handling. The server-side
factory reads and validates search configuration lazily; missing configuration
never falls back to mock fixtures. The old `createMockSearchTool` is retained for
explicit tests/development only.

Both providers use at most twenty results per call (ten by default), with no
pagination or automatic retries. The default ten-second deadline covers the full
request and response body, and the default one-MiB cap checks actual streamed
bytes even if Content-Length is missing or inaccurate. Requests reject redirects.
Only server-configured HTTPS endpoints receive credentials; result URLs are not
fetched. External titles/snippets remain untrusted data. Tool lifecycle events
provide observability without exposing keys, provider error bodies, or hidden
reasoning. Typed, sanitized provider errors survive the existing tool wrapper as
its `cause`, for later budget-aware retry decisions.

E1 adds a developer-only `search:smoke` command for one live request. It is not
registered with DSH or exposed as an Agent shell capability. Production workflow
composition through the Gateway and run-wide budgets remain E2; E1 alone does
not make the research endpoint execute a complete research run.

ADR-005 adds a selectable MCP search adapter at the existing composition boundary:

```text
createSearchTool -> SearchTool -> McpSearchProvider (apps/agent)
                                   -> MCP stdio -> agent-web-search-mcp
                                                   -> DDGS / Exa / Parallel
```

The fixed host-controlled executable and tool name are not Agent capabilities.
The adapter forwards no application secrets, maps only original source rows,
ignores generated answers, deduplicates URLs, and caps combined results. A single
deadline covers startup through search, with session cleanup after every call.
The decoded MCP response is size-checked after SDK parsing. See
`docs/decisions/005-mcp-search-provider.md` for the infrastructure allowance and
buffer, partial-provider-failure, and search-budget limitations.

V0.1-C2-A defines the evidence boundary without adding persistence:

```text
SearchResult (tool output)
        ↓  C2-C explicit mapping and persistence integration
Evidence
  ├── EvidenceId
  ├── EvidenceSource.url
  ├── title
  ├── excerpt
  └── retrievedAt
        ↑
Claim.evidenceRefs[] -> EvidenceId
```

`SearchResult` is not `Evidence`. Evidence preserves an original source
excerpt and its retrieval timestamp; it is not an LLM summary. An
`EvidenceReference` contains only an `EvidenceId`, never a duplicated evidence
snapshot. Core evidence fields are readonly by contract.

Example:
```TypeScript
interface SearchProvider {
  search(
    query: string
  ): Promise<SearchResult[]>;
}
```

## 7. Domain Layer

Core domain objects:
```Text
User
Project
ResearchRun
ResearchStep
Source
Evidence
Opportunity
OpportunityScore
ValidationPlan
```
## 8. Research Execution
```Text
Create Research
       ↓
Create ResearchRun
       ↓
Create Agent Session
       ↓
Execute Research
       ↓
Stream Events
       ↓
Persist Business Results
       ↓
Generate Report
       ↓
Generate Validation Plan
```
## 9. Event Model

The product uses domain-level events.
```TypeScript
type AgentEvent =
  | AgentStartedEvent
  | ResearchStepStartedEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | EvidenceCreatedEvent
  | ResearchStepCompletedEvent
  | OpportunityCreatedEvent
  | AgentCompletedEvent
  | AgentFailedEvent;

```
These events are transport-independent.

SSE is only one transport implementation.

## 10. Persistence

PostgreSQL stores business-level information.

DSH stores runtime execution state.

The product should store the nullable agent_session_id runtime binding, but
should not replicate the entire runtime state.

Research runs persist this binding idempotently. Rebinding the same session is
allowed; binding a different session is rejected.

Product-level runtime events are persisted in PostgreSQL through a
ProductEventStore. Events retain their event id, type, payload, occurrence time,
and per-research-run sequence for stable replay and future streaming transports.

The V0.1-B2 event stream uses PostgreSQL as the durable source of truth and a
process-local LiveEventPublisher only for low-latency notifications. The SSE
endpoint subscribes before replaying durable events, uses Last-Event-ID as the
per-run sequence cursor, deduplicates replay/live overlap, and closes after a
completed, failed, or cancelled run reaches its terminal event.

## 11. Research Limits
```Text
MAX_ROUNDS = 3
MAX_SEARCHES = 30
MAX_SOURCES = 100
TIMEOUT = 5 minutes
```
These values should be configurable.

## 12. Evidence Architecture

```text
Source
↓
Evidence
↓
Claim
↓
Opportunity
```

Every important opportunity should have supporting evidence.

## 13. Security

External web content is untrusted.

Web content cannot:
* change system instructions
* modify permissions
* invoke forbidden tools
* access unrelated data

All Agent capabilities must be explicitly registered.

## 14. Scalability

V0.1 intentionally uses a modular monolith.

Do not introduce microservices.

Future architecture may evolve into:

```text
Web
↓
API
↓
Research Service
↓
Agent Runtime
↓
Queue / Workers
```

only when real usage justifies it.
### Evidence Store (V0.1-C2-B)

The C2 evidence persistence boundary is deliberately separate from the
older research-run-scoped `evidence` table:

```text
Evidence Domain
      ↓
EvidenceRepository (`packages/evidence`)
      ↓
DrizzleEvidenceStoreRepository (`packages/db`)
      ↓
evidence_store (PostgreSQL)
```

The repository creates validated Evidence objects and reads them back by
EvidenceId. It preserves the source URL, optional source metadata, title,
excerpt, and retrieval timestamp. Database rows are rehydrated through the
Evidence factory so invalid stored data is not silently repaired. C2-B does
not convert SearchResult to Evidence, persist claims, or implement evidence
analysis. No real PostgreSQL integration test is assumed unless the configured
PostgreSQL environment is available.

### Search Result Evidence Ingestion (V0.1-C2-C)

```text
SearchTool.execute
      ↓
SearchResult.items
      ↓
SearchResultEvidenceMapper
      ↓
createEvidence
      ↓
EvidenceRepository.create
```

The application mapping layer lives in `packages/research`. It maps each
result title, URL, and snippet to an Evidence title, source, and excerpt. The
application layer generates the EvidenceId with `crypto.randomUUID()` and
captures `retrievedAt` at the ingestion boundary. Tests inject deterministic
ID and time providers. Results are processed independently: mapping and
persistence failures are reported per item, later items continue, and no
batch transaction or URL deduplication is implied.

### Claim and Research Finding Traceability (V0.1-D1)

Evidence flows through explicit references:

evidence_store -> EvidenceReference -> Claim -> ClaimId -> Research Finding

Claim belongs to a ResearchRun, contains a validated research statement, and
references one or more existing C2 Evidence records by ID. Finding reuses the
domain Research Finding contract, belongs to the same ResearchRun, and
references one or more Claims. Neither aggregate copies Evidence content.

The application service validates referenced Evidence existence and enforces
that every Claim used by a Finding belongs to the Finding's ResearchRun before
persisting the aggregate. Repository failures remain explicit. PostgreSQL uses
normalized claims, claim_evidence_refs, research_findings, and
research_finding_claims tables. Aggregate inserts are transactional, and the
relation tables preserve stable reference order with a position column.

The existing research-run-scoped evidence table, the C2 evidence_store shape,
Agent Runtime, Agent Gateway, Product Events, and SSE contracts remain
unchanged.

### Research Quality Control (V0.1-D2)

V0.1-D2 adds an independently callable, deterministic quality assessment
boundary on top of the D1 trace:

Research Finding -> Claims -> Evidence -> caller-provided classifications
                 -> ResearchQualityAssessment

The caller explicitly supplies each Claim/Evidence relation as supports,
contradicts, or unclear, together with an Evidence semantic kind and source
kind. The quality service does not infer these values with an LLM, URL pattern,
or search pipeline. Missing relation or classification input is treated as
unknown and produces an explainable review issue.

The assessment evaluates support coverage, source diversity, duplicate source
URLs, incomplete classifications, strong Claim language with limited support,
and coexistence of supporting and contradicting relations. Coexistence creates
an EvidenceConflictCandidate; it does not automatically conclude that the
underlying Evidence content is factually contradictory.

Every result contains rule IDs, reasons, involved Claim and Evidence IDs,
relevant source URLs, blocking severity, and a human-review flag. Assessment
statuses are sufficient, needs_review, insufficient, or conflicted, while the
complete issue list is preserved when multiple rules trigger.

D2 assessments are calculated from the existing D1 trace and are not persisted.
No database table, migration, Repository contract, Agent Runtime flow, Agent
Gateway behavior, Product Event, SSE contract, Search Tool, or Evidence
ingestion behavior changes in D2.

### Research Workflow Application Contract (V0.1-D3-A)

D3-A defines a small application-layer contract in
`packages/research/src/research-workflow.ts`. It describes the fixed V0.1
research step dependency graph, workflow and step execution states, failure
categories, bounded retry semantics, and workflow input validation. The
contract is descriptive and deterministic; it is not a general-purpose DAG
engine and does not execute side effects.

The default dependency graph is:

```text
market_understanding
  ├── pain_point_research ───────┐
  ├── competitor_research ───────┼──> opportunity_analysis
  └── market_signal_research ────┘              │
                                                └──> report_generation
```

The three middle research steps depend on `market_understanding` and are
independent of one another. The contract expresses those dependencies without
introducing a scheduler or promising parallel execution. Workflow execution
state is application-level and is not persisted by D3-A; the existing
ResearchRun, AgentGateway, AgentRuntime, Product Events, SSE, and PostgreSQL
contracts remain unchanged.

`ResearchWorkflowStepStatus` includes `skipped` for future application
semantics, while the existing domain/database `ResearchStepStatus` remains
unchanged. The default V0.1 steps are non-skippable and have one attempt.
Retries are explicit and bounded by `maxAttempts`; a handler may resolve a
running step as skipped only when the definition allows it. No exactly-once or
cross-process recovery guarantee is implied.

D3-A only defines the integration boundary for Search, Evidence Ingestion,
ResearchFindingService, and ResearchQualityAssessmentService. D3-B adds an
`InMemoryResearchWorkflowCoordinator` that executes the contract with injected
step handlers and deterministic in-process state. The coordinator does not
generate Claims, infer Evidence relationships, call DSH, or connect the real
Search, Evidence, Finding, or Quality services yet.

The coordinator reuses an invocation within the same process, stops after the
first failed step, marks pending downstream work as skipped, and supports
cooperative cancellation. This is not durable idempotency, cross-process
coordination, automatic retry, or exactly-once execution. Fake handlers and
application-level tests exercise these semantics before real service adapters
are introduced.

### Evidence Acquisition and Scoped Idempotency (V0.1-D3-D-B)

D3-C connects the first four workflow steps to the existing Search and
Evidence services. D3-D-B separates canonical Evidence identity from the fact
that a ResearchRun collected or explicitly reused it:

```text
evidence_store
      ↑
evidence_acquisitions
      ↓
research_runs
```

`evidence_store` remains compatible with the C2 contract and does not gain a
ResearchRun foreign key or URL uniqueness constraint. A successful acquisition
records the ResearchRun, workflow invocation, step, versioned source
fingerprint, and capture time. The scoped unique key is:

```text
research_run_id + workflow_invocation_key + step_id + source_fingerprint
```

The fingerprint is SHA-256 over a normalized URL, title, and excerpt. It is an
operation identity component, not the Evidence primary key. Matching URLs do
not automatically merge Evidence across ResearchRuns. Reuse across runs is
explicit and creates an acquisition for the target run.

The Drizzle acquisition repository atomically creates or reuses Evidence and
creates the acquisition. Concurrent duplicate scopes return the winning record
and roll back losing Evidence inserts. Claims may only be created from Evidence
associated with the Claim's ResearchRun. Existing stored Claims remain readable
without migration backfill.

### Explicit Research Synthesis and Quality Integration (V0.1-D3-E-B)

D3-E-B adds a dependency-injected application boundary between collected
Evidence and research conclusions:

```text
typed workflow Evidence artifacts
        ↓
ResearchSynthesisPlanProvider
        ↓
explicit Claim / Finding / relationship drafts
        ↓
ResearchFindingService
        ↓
ResearchQualityAssessmentService
```

The provider must explicitly supply Claim text, Finding content, Claim-to-
Evidence relationships, and Evidence semantic/source classifications. The
workflow does not turn excerpts into Claims, assume that Evidence supports a
Claim, or infer classifications. A production LLM, Skill, or DSH provider is
not implemented by this phase; tests inject deterministic providers.

The analysis handler accepts only typed Evidence artifacts emitted by completed
search steps. Plan references outside that set, unknown Claim references, and
duplicate identities or assessments are rejected before persistence. Claim and
Finding database IDs are deterministically derived from the ResearchRun,
workflow invocation, and stable plan-local IDs. Replays reuse identical
aggregates and reject content conflicts. Claim creation can remain committed
when a later Finding or quality
operation fails; D3-E-B does not claim a global synthesis transaction.

Quality assessment runs immediately after each Finding is available and remains
non-persistent. `sufficient`, `needs_review`, `insufficient`, and `conflicted`
are research quality outcomes rather than technical execution states. The
analysis step completes with typed Finding and Quality artifacts plus explicit
diagnostics for non-sufficient outcomes. Report generation, Opportunity domain
creation, scoring, durable workflow execution, and a real synthesis provider
remain outside this phase. No database schema or migration changes in D3-E-B.

### DSH-Backed Structured Synthesis (V0.1-D3-E-C)

D3-E-C supplies a production-capable synthesis boundary without transferring
workflow ownership to DeepSeek Harness:

```text
InMemoryResearchWorkflowCoordinator
        -> ResearchWorkflowAnalysisHandler
        -> DshResearchSynthesisPlanProvider
        -> AgentRuntimeReasoner
        -> DeepSeekHarnessReasoner
        -> product_scout_submit_synthesis
```

`AgentRuntimeReasoner` is a narrow, runtime-neutral port for one bounded
structured reasoning operation. It does not expose DSH sessions, Cordis, or
database contracts. The provider loads referenced Evidence through the existing
repository, builds a bounded prompt with external content explicitly marked as
untrusted, and validates the returned `ResearchSynthesisPlan` before the existing
analysis handler performs semantic reference validation and persistence.

The DSH adapter accepts exactly one successful schema-validated submission tool
call. It pairs `tool/call` with `tool/result`, parses the raw call arguments as
unknown JSON, and never treats assistant prose or `finalResponse` as business
data. The submission tool has no persistence or external side effects.

Each reasoning operation uses an isolated Harness lifecycle, explicit DSH home,
explicit environment allowlist, bounded timeout, and a synthesis-only profile
patch that disables persistent shells and MCP resources. DSH remains pinned to
`0.2.1-alpha.1`; the existing PoC is unchanged. See ADR-006.

### Analysis Workflow Runtime Composition (V0.1-D3-E-D)

D3-E-D distinguishes the complete report contract from the currently executable
analysis contract:

```text
product-scout-research-v0.1
  Search -> Evidence -> Finding -> Quality -> Report
  missing Report => failed

product-scout-analysis-v0.1
  Search -> Evidence -> Finding -> Quality
  successful Quality evaluation => completed
```

`ResearchWorkflowRuntime` adapts the versioned Analysis Workflow to the existing
`AgentRuntime` contract. It owns local sessions, maps workflow step outcomes to
transport-independent Agent events, and coordinates cancellation with both the
in-memory Coordinator and the active `AgentRuntimeReasoner` request.

`createAnalysisWorkflowRuntimeFactory` is a dependency-injected composition root
for the existing Search, Evidence acquisition, Finding, Quality, and synthesis
services. Concrete database connections, Search provider configuration, and the
Reasoner transport remain caller-owned. The Web Gateway production composition
is intentionally unchanged in D3-E-D; activating the analysis-only workflow at
`POST /api/research` requires a separate product/API acceptance decision so it
cannot be mistaken for full report completion.

### Evidence-Backed Opportunity Scoring Contract (V0.1-D3-F-A)

D3-F-A defines the pure application boundary between quality-controlled
Findings and future persisted Opportunities:

```text
Finding + Quality status + derived Evidence IDs
        -> OpportunityAnalysisPlanProvider
        -> strict Opportunity draft contract
        -> deterministic calculateOpportunityScore
        -> ScoredOpportunityProposal
```

The provider supplies product fields, references to known Findings, seven
dimension inputs, and an explanation for every dimension. It cannot supply the
weighted total. The application validates every `0-100` input and calls the
existing domain scoring function, preserving its fixed weights and reproducible
rounding.

Opportunity Evidence IDs are derived from referenced Findings; provider output
cannot inject Evidence IDs. Only Findings with `sufficient` quality and no
human-review requirement may support a proposal. An empty proposal list is a
valid evidence-first outcome and does not cause the application to fabricate an
opportunity.

This phase does not persist Opportunities, change the database schema, invoke
DSH, alter the Workflow handler, or generate a Report. Persistence idempotency,
DSH structured submission, and workflow integration remain later phases.

### Evidence-backed Research Report Generation (V0.1-D3-F-C)

D3-F-C completes the default six-step workflow without changing the existing
five-step Analysis Workflow. Report generation consumes only explicit artifacts
from completed opportunity analysis:

```text
quality-approved Findings + persisted Opportunities
        -> ResearchReportPlanProvider
        -> AgentRuntimeReasoner
        -> product_scout_submit_report
        -> strict parser and reference validation
        -> ResearchReportStore
```

Every report section references at least one available Finding or Opportunity.
Report content contains high-level conclusions and limitations, not private
chain-of-thought. Model output cannot choose the persisted report ID or
timestamp. The deterministic report UUID is derived from ResearchRun and
workflow invocation identity; an identical replay returns the existing report,
while conflicting content is rejected.

`research_reports` is business data owned by PostgreSQL and has one row per
ResearchRun. The DSH submission Tool validates structure but performs no
persistence. A dedicated DSH patch exposes only the report submission Tool and
continues to disable shell and MCP resources. DSH remains pinned to the current
version.

`createAnalysisWorkflowRuntimeFactory` retains the partial
`product-scout-analysis-v0.1` contract. The new
`createResearchWorkflowRuntimeFactory` composes `product-scout-research-v0.1`
and completes only after a traceable report is persisted. At D3-F-C,
ValidationPlan, report HTTP presentation, and production Gateway switching
remain separate work; D3-F-D adds ValidationPlan as described below.

### Seven-day Validation Plan (V0.1-D3-F-D)

The fixed `report_generation` step produces two separately persisted business
artifacts:

```text
ResearchReport + persisted Opportunities
        -> ValidationPlanProvider
        -> AgentRuntimeReasoner
        -> product_scout_submit_validation_plan
        -> strict Day 1-7 validation
        -> ValidationPlanStore
```

The plan contains exactly seven ordered days. Each day has a focused objective,
one or more concrete activities, and measurable success criteria. The model
cannot choose the database ID, ResearchRun association, or timestamps.

ValidationPlan persistence uses deterministic invocation identity and one row
per ResearchRun. Identical replay returns the existing plan; conflicting replay
is rejected. Report and plan writes remain separate idempotent aggregates: if
plan generation fails after Report persistence, the step fails and a retry
reuses the Report before resuming the plan.

An empty Opportunity result is valid for the partial Analysis Workflow, but the
full workflow does not fabricate a product validation plan without a persisted
Opportunity. DSH remains isolated behind `AgentRuntimeReasoner` and pinned to
the existing version. API/UI presentation and production Gateway switching are
not part of D3-F-D.

### Production Research Workflow Activation (V0.1-D3-G-A)

The Web production Gateway now injects the complete application-owned workflow
instead of the earlier echo-only DSH PoC runtime:

```text
POST /api/research
  -> DefaultAgentGateway
  -> AgentRuntimeFactory
  -> ResearchWorkflowRuntime
  -> Coordinator
     -> Search / Evidence acquisition
     -> Finding / deterministic Quality control
     -> Opportunity scoring and persistence
     -> ResearchReport and ValidationPlan persistence
```

Concrete DSH reasoners remain inside `apps/agent`. Each structured operation
uses its dedicated patch and submission Tool; `apps/web` supplies only Search
and Repository implementations. Production configuration has no Mock or PoC
fallback and requires an explicit `DSH_HOME`.

The runtime applies `AGENT_TIMEOUT_MS` as the overall workflow deadline. The
fixed graph requires four searches, and the configured source budget is split
across the four research steps. Timeout cancels both the Coordinator and active
reasoners and returns failure, never completion.

This activation does not make the process-local Coordinator durable. Gateway
trajectory events are still published after `run()` returns rather than during
execution. Durable ResearchStep updates, restart recovery, presentation APIs,
and truly live incremental event delivery remain later phases. See ADR-010.

### Incremental Progress and Durable Steps (V0.1-D3-G-B)

`AgentRunInput` now accepts an optional asynchronous event sink. The Workflow
Runtime awaits that sink for agent and step lifecycle events, while retaining
the complete trajectory. The Gateway deduplicates both paths by event ID,
persists Product Events before notifying live SSE subscribers, and treats
delivery failure as a run failure.

Step lifecycle is also projected into `research_steps` through a persistence-
agnostic port. A stable UUID derived from ResearchRun and step type identifies
the business step; runtime attempts and hidden reasoning are not copied into
PostgreSQL. The existing unique `(research_run_id, type)` constraint makes
retries update the same row.

`POST /api/research` now returns the created ResearchRun ID without waiting for
the workflow to finish. Execution continues in the current server process, and
failures are observed through ResearchRun state and durable events. This is not
a queue or durable worker: process restart recovery and exactly-once execution
remain outside V0.1-D3-G-B. See ADR-011.

### V0.1 Local Product Workspace and Source Collection

The local Product UI now exposes Project/Research read and create APIs,
reports, opportunities, score explanations, MVPs, seven-day plans, and
Finding → Claim → Evidence links. Repository queries are scoped to the configured
server owner. It has no public authentication contract; dev/start bind to loopback
and Route Handlers reject non-local/cross-origin requests. See ADR-012.

Search is decorated by `SourceResearchSearch`: a bounded HTTPS fetch port
collects original page excerpts and a Source repository stores metadata. Failed
fetches retain the original Search excerpt and explicitly report failure. The
fetch adapter resolves and pins public IPv4 destinations, rejects redirects,
and enforces a shared DNS/request deadline and streamed byte cap. Acquisition
scope, not URL uniqueness, continues to determine Evidence idempotency.

Caller constraints reach Search and each structured reasoning operation while
the original goal remains unchanged in business persistence. Tools and Evidence
notifications use the awaited Runtime event sink. The Gateway serializes state
writes per run in its process, checks current state before writes, closes active
steps on cancellation/failure, and persists terminal run status before terminal
notifications. This does not provide cross-process locking or an atomic outbox.
SSE durable polling recovers notifications missed by the in-process publisher.

The pinned DSH SDK must retain its module location for `import.meta` child-runtime
resolution. The Next server build resolves that SDK from its importing Agent
package and leaves it as a native dynamic import; no DSH API is introduced into
Product code and no DSH version changes. This build is for the checked-out local
workspace, not a validated standalone-container deployment.

See `v0.1-acceptance.md` for current executed checks. Historical phase-status
sections above describe their respective milestones, not current remaining work.
