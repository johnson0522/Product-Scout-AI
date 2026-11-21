# ADR-012: Local V0.1 product workspace and source fetching

## Status

Implemented under the user's V0.1 completion authorization. Public/multi-user
deployment remains unapproved and unsupported.

## Context

The research workflow exists, but users cannot create projects or inspect its
persisted artifacts. No authentication provider or identity policy was selected.
Search snippets are persisted but source pages are not fetched.

## Decision

- Keep Next.js Route Handlers and the existing database model. Product APIs
  use repository ports, scope every project/run operation to the configured
  `PRODUCT_SCOUT_OWNER_ID`, and reject cross-origin and non-loopback requests.
  The caller cannot supply an owner ID. Normal dev/start bind to 127.0.0.1.
- This is local evaluation access control, not authentication. Remote hosting
  requires a separate identity/deployment decision before exposure.
- Add create/list/detail Project and run/result read routes. Report responses
  include Opportunities and ValidationPlans; Evidence responses include the
  run's acquired Evidence, Claims, and Findings. No runtime trajectory is public.
- Render untrusted output as React text, never raw HTML. Evidence links allow
  only HTTP(S). Empty/failed/partial results remain explicit.
- Add a bounded public-HTTPS WebFetcher port. The Node adapter resolves only
  IPv4, rejects all private/reserved answers, pins the selected IP to the TLS
  connection with the original hostname for verification, rejects redirects,
  and caps the request/body/text under one deadline. No cookies or credentials.
- Fetch capped Search results and store Source metadata through SourceRepository.
  Production selects up to five results per step to keep twenty bounded page
  excerpts within the existing synthesis context envelope; source budgets may
  reduce this further. The global 100-source budget remains a maximum.
  Failed pages retain the original search excerpt and emit a failed fetch event.
  Existing C2 Evidence/acquisition semantics and historical migrations are retained.
- C2 Evidence events may omit the legacy sourceId: their canonical provenance
  is Evidence.source.url. Never invent a sources-table foreign key.
- Delay terminal Product Events until ResearchRun state is committed; discard
  late completion notifications after cancellation/timeout. This is ordered
  best-effort recovery across separate transactions, not an outbox guarantee.
- Keep the pinned SDK external to the Next server bundle using a native dynamic
  import resolved from its Agent importer. Default Next external resolution
  cannot resolve pnpm's Agent-only dependency from the Web package and otherwise
  bundles away the SDK's `import.meta` location. No direct SDK dependency is
  added to the Product manifest; this is a local workspace build contract.

## Limitations

No login, public hosting, cross-process execution ownership, durable worker,
exactly-once execution, JavaScript page rendering, PDF parsing, IPv6 fetch,
redirect following, or automatic source retries. Source rows preserve metadata;
the bounded page excerpt is preserved as Evidence, not a full web archive.
