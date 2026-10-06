
# Product Scout AI

Product Scout AI is an evidence-based product discovery Agent.

It helps founders and product teams discover software opportunities by researching markets, users, competitors and market signals.

## Core Workflow

```text
User Goal
   ↓
Research Plan
   ↓
Market Research
   ↓
Pain Point Research
   ↓
Competitor Research
   ↓
Market Signal Research
   ↓
Evidence
   ↓
Opportunity Analysis
   ↓
Opportunity Score
   ↓
Research Report
   ↓
7-Day Validation Plan
```
# Tech Stack

## Product

* React
* Next.js
* TypeScript
* Tailwind CSS
* shadcn/ui

## Agent

* DeepSeek Harness
* Cordis

## Data

* PostgreSQL
* Drizzle ORM
* Redis

## Development

* pnpm
* Turborepo
* Vitest
* Playwright
* Docker
* Coolify

## Architecture

                   ┌──────────────────────┐
                   │      Next.js Web      │
                   │                      │
                   │ Dashboard             │
                   │ Research Workspace    │
                   │ Reports               │
                   └──────────┬───────────┘
                              │
                              ▼
                   ┌──────────────────────┐
                   │    Agent Gateway     │
                   └──────────┬───────────┘
                              │
                              ▼
                   ┌──────────────────────┐
                   │    AgentRuntime      │
                   │     Interface        │
                   └──────────┬───────────┘
                              │
                              ▼
                   ┌──────────────────────┐
                   │ DeepSeek Harness     │
                   │ + Cordis             │
                   └──────────┬───────────┘
                              │
                 ┌────────────┼────────────┐
                 ▼            ▼            ▼
              Skills        Tools       Session
                 │            │
                 ▼            ▼
             Research      Web Search
             Methods       Web Fetch
                              │
                              ▼
                         Evidence
                              │
                              ▼
                         PostgreSQL

## V0.1

V0.1 focuses on validating the research engine.

### Supported
- Project creation
- Research creation
- Web research
- Evidence collection
- Competitor research
- Pain point research
- Opportunity analysis
- Opportunity scoring
- Report generation
- Validation plan
- Live progress

### Not Supported
- Payments
- Email
- Social publishing
- CRM
- ERP
- Autonomous external actions
- Multi-agent system
- Vector database
- Kubernetes

## Development

Install dependencies:
```Bash
pnpm install
```

Run development:
```Bash
pnpm dev
```

Run type checking:
```Bash
pnpm typecheck
```

Run tests:
```Bash
pnpm test
```

Run lint:
```Bash
pnpm lint
```

## Environment

Copy:
```Bash
cp .env.example .env
```
Required environment variables will be documented as the implementation progresses.

## Architecture Documents
- docs/architecture.md
- docs/v0.1.md
- docs/agent-development.md

 Architecture decisions:

- docs/decisions/001-nextjs.md
- docs/decisions/002-agent-runtime.md
- docs/decisions/003-postgresql.md
- docs/decisions/004-sse.md