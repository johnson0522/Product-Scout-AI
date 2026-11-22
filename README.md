
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

Create and initialize the development database before running database-backed
features: [Database setup](docs/database-setup.md).

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
Configure `DATABASE_URL`, `PRODUCT_SCOUT_OWNER_ID`, `DSH_HOME`, the selected
model credential, and the Search provider before starting research.
The default DSH route uses `DEEPSEEK_API_KEY`. The explicit `yunqiao` route uses
`LLM_API_KEY` instead; credentials are isolated per route.

### Local workspace startup

V0.1 runs as a **local, single-owner evaluation workspace**, without login.
Do not expose it through a public reverse proxy or override its loopback bind.
Project and run access is scoped to the server-configured owner, not an ID
supplied by the browser. Authentication for remote/multi-user hosting requires
a separate design decision.

After initializing your development database as described above:

1. Generate a UUID with `node -e "console.log(require('node:crypto').randomUUID())"`.
2. Set `PRODUCT_SCOUT_OWNER_ID` to that value in the root `.env`.
3. Run `pnpm db:seed-owner` once. This explicit operator command inserts only
   the configured owner and never runs automatically during application startup.
4. Set the DSH and Search settings documented below, then run
   `pnpm --filter @product-scout/web dev` and open `http://127.0.0.1:3000/projects`.

The Web dev/start scripts load the root `.env` using Node's `--env-file`
(Node 20.6+). Existing shell variables take precedence. Production-mode local
evaluation uses `pnpm build` followed by `pnpm --filter @product-scout/web start`.
The UI supports project creation, research history, six-step progress, cancellation,
reports, explained scores, MVPs, seven-day plans, and Finding/Claim/Evidence links.
Execution is process-local: keep the server running; restarts do not resume work.

Search results are fetched through a bounded public-HTTPS adapter and Source
metadata is stored through a Repository. Private/reserved destinations, redirects,
credentials, and alternative ports are rejected. A failed page fetch retains the
original search excerpt with an explicit failed tool event. This is not a full
web archive and does not render JavaScript or parse PDFs.

### Validation

```powershell
$env:CI='true'
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
# Requires a Playwright Chromium installation; Edge can be selected on Windows.
$env:PLAYWRIGHT_CHANNEL='msedge'
pnpm test:e2e
git diff --check
```

Browser contract tests use HTTP fixtures. Dedicated PostgreSQL tests execute
real migrations and real repositories; see [the database test guide](docs/postgres-integration.md).
Neither test category claims live-model research quality. Current acceptance,
endpoint contracts, exact test counts and outstanding environment requirements
are recorded in [V0.1 acceptance](docs/v0.1-acceptance.md).

### Real web search (E1)

The default search integration uses JerryLiu369's
[agent-web-search-mcp](https://github.com/JerryLiu369/agent-web-search) through
MCP stdio. Install Python 3.10+ and an isolated search environment:

```powershell
python -m venv .venv-search
.\.venv-search\Scripts\python.exe -m pip install -r apps/agent/search-requirements.txt
```

Configure the root `.env` (use the absolute path to your installed executable):

```dotenv
SEARCH_PROVIDER=agent-web-search-mcp
SEARCH_MCP_COMMAND='D:/AI Project/product-scout/.venv-search/Scripts/agent-web-search-mcp.exe'
SEARCH_TIMEOUT_MS=60000
SEARCH_MAX_RESPONSE_BYTES=1048576
```

On macOS/Linux, use `.venv-search/bin/python` to install and set
`SEARCH_MCP_COMMAND` to the absolute `.venv-search/bin/agent-web-search-mcp` path.
An executable installed on PATH can be configured as `agent-web-search-mcp`.
The adapter enables only the keyless `ddgs`, `exa`, and `parallel` providers;
it does not forward application API keys or database credentials. It calls only
`web_search`, maps original `description` fields to snippets, deduplicates exact
URLs, caps the combined output at the requested limit, and ignores synthesized
answers. Failed backends may be omitted by the server when another succeeds;
total provider failure remains an explicit tool error. Availability still depends
on each backend's network access and rate limits.

Each call starts and closes a dedicated MCP session, with a deadline covering
startup, initialization, and search. `SEARCH_MAX_RESPONSE_BYTES` caps the decoded
MCP tool result after SDK parsing, rather than limiting transport buffer memory.
The Agent receives no shell or process-management tool. See
[ADR-005](docs/decisions/005-mcp-search-provider.md) for the infrastructure boundary.
Upstream attempts are capped at five seconds so that a slow backend does not
consume the entire fan-out deadline; a backend can make several such attempts.

Brave and Tavily remain available by selecting their HTTP adapter instead:

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

### Production research runtime

`POST /api/research` uses the complete application-owned Research Workflow.
Configure an explicit DSH state directory and model credential; production does
not fall back to the echo PoC or a mock search provider:

```dotenv
DSH_HOME=.dsh-runtime
DEEPSEEK_API_KEY=your-model-key
DSH_PROVIDER=
DSH_MODEL=
AGENT_MAX_SEARCHES=30
AGENT_MAX_SOURCES=100
AGENT_MAX_ROUNDS=3
AGENT_TIMEOUT_MS=300000
```

The fixed workflow requires four Search calls. `AGENT_MAX_SEARCHES` and
`AGENT_MAX_SOURCES` must each be at least four; invalid values fail at
composition time. `AGENT_TIMEOUT_MS` bounds the complete workflow and each
individual DSH reasoning operation.

For a Yunqiao GPT-only plan, replace the model settings above with:

```dotenv
DSH_PROVIDER=yunqiao
DSH_MODEL=gpt-6.1-sol
LLM_BASE_URL=https://api.yunqiao.me/v1
LLM_API_KEY=your-yunqiao-key
```

This route uses the pinned DSH's official `dsh-llm-pi-ai` extension with
`openai-responses`; no separate DSH installation or version upgrade is needed.
It currently allows only the tested endpoint/model. `LLM_PROVIDER` does not
select the Runtime route. Restart the application after changing `.env`.

Run the real DSH Provider check before starting a full research job:

```powershell
pnpm --filter @product-scout/agent dsh:smoke
```

It performs a harmless addition/receipt roundtrip and submits an empty synthesis
test contract through the production adapter. It uses model quota but does not
write business data. See [Provider setup and validation](docs/yunqiao-runtime-provider.md).

Production collects at most five results per research step (twenty overall),
further reduced by `AGENT_MAX_SOURCES`. This leaves room for bounded page
excerpts in the existing 200,000-character synthesis envelope. The documented
100-source limit is a safety ceiling, not a collection target. Oversized provider
excerpts or complete prompts still fail explicitly rather than being silently
rewritten into unsupported Evidence.

Run a live smoke check from the repository root (requires Node 20.6+ and a root
`.env` file; this makes one real search request and may use provider quota):

```bash
pnpm --filter @product-scout/agent search:smoke "hvac software"
```

The command prints tool lifecycle events to stderr and raw search results to
stdout. It does not write to the database. Missing provider configuration (or
missing API keys when using Brave/Tavily) fails explicitly;
MockSearchProvider remains an explicitly selected test fixture only.

For application composition, use the server-side `createSearchTool` export from
`@product-scout/agent/search`. It accepts an explicit `SearchConfig` or lazily reads
the process environment. The host application must load its environment before
calling the factory; the smoke command loads the root `.env` itself.

Requests default to ten results and are capped at twenty,
without pagination or automatic retries. For Brave/Tavily, the ten-second default
deadline covers response body reads; their one-MiB limit applies to actual streamed bytes. Search snippets
remain untrusted source excerpts, not verified page content or generated answers.
Structured provider failures are retained as `SearchToolExecutionError.cause`;
events omit secrets and upstream response bodies.

The production Gateway now connects Search and evidence ingestion to the full
Finding, Opportunity, Report, and ValidationPlan workflow. Incremental event
publication persists agent and step lifecycle events during execution, and
ResearchStep business state is stored in PostgreSQL. Execution remains
process-local and does not recover automatically after a server restart.

## Architecture Documents
- docs/architecture.md
- docs/v0.1.md
- docs/agent-development.md

 Architecture decisions:

- docs/decisions/001-nextjs.md
- docs/decisions/002-agent-runtime.md
- docs/decisions/003-postgresql.md
- docs/decisions/004-sse.md
- docs/decisions/005-mcp-search-provider.md
- docs/decisions/006-coordinator-owned-reasoning.md
- docs/decisions/007-opportunity-submission-persistence.md
- docs/decisions/008-evidence-backed-research-report.md
- docs/decisions/009-seven-day-validation-plan.md
- docs/decisions/010-production-research-workflow-activation.md
- docs/decisions/011-incremental-progress-and-step-persistence.md
- docs/decisions/012-local-product-workspace-and-fetch.md
