# ADR-005: Agent Web Search through a fixed MCP search adapter

## Status

Accepted

## Context

Direct Tavily requests have intermittently failed with connection timeouts.
The user requested JerryLiu369/agent-web-search (PyPI agent-web-search-mcp),
whose default DDGS, Exa, and Parallel backends do not require API keys.
Changing providers does not guarantee network availability.

## Decision

Keep SearchTool, SearchProvider, SearchResult, evidence ingestion, AgentRuntime,
and the Gateway contracts unchanged. Add McpSearchProvider to the server-side
apps/agent composition layer. Use the official TypeScript MCP client SDK rather
than implementing JSON-RPC, initialization, and cancellation ourselves.

The host launches a server-configured executable directly through MCP stdio
with no shell and no arbitrary argument configuration. It calls only web_search
with validated query, capped result count, and the fixed ddgs/exa/parallel set.
Executable selection is host configuration, never agent or web-content input.
This is a narrow infrastructure process allowance; it does not grant the V0.1
Agent shell execution or arbitrary filesystem access. No DSH plugin, second
Agent, remote service, or new application backend is introduced.

Install the pinned Python package in an isolated environment. The SDK passes
basic OS environment variables plus explicit search settings to the child;
application secrets and optional paid-provider keys are not forwarded. The MCP
server's stderr and error bodies are not exposed through product events.

Use one session per search. Bound startup, initialization, and search by one
deadline, defaulting to 60 seconds for MCP; close on success, error, or timeout.
The upstream per-request timeout is capped at five seconds and at most one third
of that budget: keyless Parallel may make three sequential calls, and DDGS may
try multiple backends before returning. There are no adapter retries.

Validate normalized sources, preserve descriptions verbatim, ignore generated
answers, deduplicate exact URLs, and cap the combined result count. Empty results
from a successful backend are valid; all-backend failure remains an explicit
error. External content remains untrusted data.

## Consequences and limitations

The host needs Python 3.10+ and the isolated search package in addition to Node.
Per-call process startup adds overhead but avoids shared mutable session state.
The one-MiB response limit checks the decoded tool result after SDK parsing; it
does not bound the SDK's raw stdio buffers. Backend failures can be omitted from
successful upstream responses, so success does not mean every backend succeeded.
One application search now fans out to up to three upstream backends; existing
application search counters count invocations, not individual backend requests.
Run-wide scheduling and budgets remain the responsibility of the research
workflow. Brave/Tavily HTTP implementations remain selectable.
