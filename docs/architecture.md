

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

The product should store:
```Text
agent_session_id
```
but should not replicate the entire runtime state.

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