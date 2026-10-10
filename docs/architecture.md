

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
