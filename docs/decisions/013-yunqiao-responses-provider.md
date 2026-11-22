# ADR-013: Yunqiao Responses via the Pinned DSH Provider Extension

## Status

Accepted

## Context

The available Yunqiao subscription serves GPT models. Direct Responses tests
verified `gpt-6.1-sol`, text streaming, and function-call/result exchange. The
default DSH route uses Anthropic Messages, so changing only its model ID is
insufficient. DSH must remain pinned to `0.2.1-alpha.1`, and Product code must
not depend on runtime-specific protocol details.

The installed official `@deepseek-ai/dsh-llm-pi-ai` package of that same version
documents custom provider routes with `api`, `baseURL`, `apiKeyEnv`, `models`,
SSE transport, request deadlines, and provider-owned retry policy. It is already
installed as part of the pinned DSH dependency tree.

## Decision

Register an explicit `yunqiao` route through the official pi-ai adapter using
`openai-responses`. Mount the route's Cordis patch inside
`DeepSeekHarnessReasoner`, ahead of the existing operation-specific tool patch.
All four production reasoners reuse it through dependency injection; neither
`AgentRuntimeReasoner` nor Product/Gateway/Repository contracts change.

The first supported route is intentionally narrow: `https://api.yunqiao.me/v1`
and `gpt-6.1-sol`. Provider selection validates credentials, endpoint, and model
before launch. Missing/malformed configuration fails explicitly without a
fallback to another model or provider. Only `LLM_API_KEY` is passed for this
route; the default route retains `DEEPSEEK_API_KEY`. No credential enters YAML.

Use SSE, a 60-second per-request deadline, a 30-second idle deadline, and zero
automatic retries. The initial deployment catalog uses a conservative 32,768
context limit and 8,192 output-token cap; these are application limits, not
verified maximum model capabilities. Do not declare image or reasoning-effort
capabilities without separate verification. The existing operation/workflow
timeout and cancellation lifecycle still bound the complete execution.
The Reasoner enforces an overall deadline in addition to SDK RPC timeouts;
SDK request timeouts alone do not bound the later wait for session idle.

Launch the child from `apps/agent/src/dsh`, separate from the Product `.env`,
while the SDK session's workspace remains the repository root. Resolve tool
modules relative to that launch directory. Refuse `.env` files in child launch
and home directories: DSH's own env-layer loader would otherwise bypass the
explicit child allowlist (and currently rejects Product `.env`'s `DSH_HOME`).

Treat a failed, blocked, aborted, or token-limited `turn/end` as failure even
after a successful submission. The SDK's `run()` resolves when the session is
idle and does not itself guarantee a successful model turn. Expose a bounded
machine code rather than provider messages through this failure boundary.

## Consequences

- No new framework, custom wire-protocol implementation, dependency upgrade,
  database schema, Product API, or frontend change is required.
- DSH owns stream translation, tool replay, and execution state; Product Scout
  continues to accept only paired, successful schema-submission events.
- The Yunqiao patch disables the unused default DeepSeek adapter and automatic
  session-title generation. Existing operation patches still disable shell and
  MCP resource tools. A developer-only probe patch is never mounted in production.
- The real smoke check exercises DSH initialization, model streaming, a locally
  validated random tool receipt, Product event projection, cleanup, and an actual
  production synthesis schema. It is separate from offline unit tests.
- Full live research quality, database persistence, provider billing identity,
  proxy buffering, standalone deployment, and other models remain separate
  acceptance concerns.

## Version-specific evidence

The installed official package README, `lib/types/config.d.ts`,
`lib/types/catalog.d.ts`, `lib/index.js`, SDK public option declarations, and
`dsh-sdk-minimal/cordis.patch.yml` were inspected before implementation.
The pinned SDK source confirms `DeepSeekHarnessOptions.patches`, `env`,
`processCwd`, `cwd`, provider/model selection, and the idle-based `run()` contract.

- [Official provider documentation source](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/llm/llm-pi-ai/README.md)
- [Cloud gateway guide](https://www.quya.org/guide)

Installed `0.2.1-alpha.1` artifacts, together with actual smoke execution, are
the implementation evidence; a newer upstream branch is not a compatibility promise.
