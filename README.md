
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

### Real web search (E1)

Configure the root `.env` for either Brave or Tavily:

```dotenv
SEARCH_PROVIDER=brave
SEARCH_API_KEY=your-provider-key
SEARCH_BASE_URL=
SEARCH_TIMEOUT_MS=10000
SEARCH_MAX_RESPONSE_BYTES=1048576
```

`SEARCH_BASE_URL` is an optional **complete HTTPS search endpoint**, not an API
prefix. Blank uses `https://api.search.brave.com/res/v1/web/search` for Brave or
`https://api.tavily.com/search` for Tavily. Custom endpoints must not contain
credentials, query parameters, or fragments. Only configure trusted endpoints:
the selected endpoint receives the search API key. Keys stay on the server.

Run a live smoke check from the repository root (requires Node 20.6+ and a root
`.env` file; this makes one real search request and may use provider quota):

```bash
pnpm --filter @product-scout/agent search:smoke "hvac software"
```

The command prints tool lifecycle events to stderr and raw search results to
stdout. It does not write to the database. Missing provider/key fails explicitly;
MockSearchProvider remains an explicitly selected test fixture only.

For application composition, use the server-side `createSearchTool` export from
`@product-scout/agent/search`. It accepts an explicit `SearchConfig` or lazily reads
the process environment. The host application must load its environment before
calling the factory; the smoke command loads the root `.env` itself.

Requests default to ten results and are capped at twenty for both providers,
without pagination or automatic retries. The ten-second deadline covers response
body reads; the one-MiB limit applies to actual streamed bytes. Search snippets
remain untrusted source excerpts, not verified page content or generated answers.
Structured provider failures are retained as `SearchToolExecutionError.cause`;
events omit secrets and upstream response bodies.

E1 makes search independently usable with the existing evidence ingestion
service. Connecting it to `/api/research`, enforcing run-wide budgets, and
generating reports remain E2 and later work.

## Architecture Documents
- docs/architecture.md
- docs/v0.1.md
- docs/agent-development.md

 Architecture decisions:

- docs/decisions/001-nextjs.md
- docs/decisions/002-agent-runtime.md
- docs/decisions/003-postgresql.md
- docs/decisions/004-sse.md
