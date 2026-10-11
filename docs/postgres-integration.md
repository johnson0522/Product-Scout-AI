# PostgreSQL Integration Tests

The C2-B and C2-C integration tests use a dedicated PostgreSQL target. They
never fall back to `DATABASE_URL` and must not be pointed at the development
database.

## Isolated test service

The test service is defined in `docker/docker-compose.test.yml`:

- service/container: `product-scout-postgres-test`
- database: `product_scout_test`
- host port: `55432`
- volume: `product_scout_postgres_test_data`

The existing development Compose service and its `product_scout` database are
not used by these tests. `.env.test.example` contains the local test-only
configuration shape; do not commit real credentials.

## Run the acceptance tests

Start the isolated service:

```text
pnpm db:test:up
```

Authorize only the dedicated target in the current shell, then apply the
formal Drizzle migrations:

```text
PRODUCT_SCOUT_TEST_DATABASE=1
TEST_DATABASE_URL=postgresql://product_scout_test:<test-password>@127.0.0.1:55432/product_scout_test
pnpm db:test:migrate
pnpm db:test:integration
```

On PowerShell, set the two variables with `$env:...` before running the same
commands. The migration runner sets `DATABASE_URL` only for its validated test
target and applies the checked-in SQL files through Drizzle's PostgreSQL
migrator. Integration scripts fail before Vitest if the marker, protocol,
host, port, or database name does not match the dedicated target.

The tests clean only rows whose IDs were generated with their per-run test
prefix. They do not truncate tables or touch the development database. Stop
the service without deleting its test volume with:

```text
pnpm db:test:down
```

Use `pnpm db:test:clean` only when the dedicated test volume itself should be
removed.

## Validation boundaries

`pnpm db:test:migrate` applies the formal Drizzle migrations first.
`packages/db/tests/postgres.integration.test.ts` then uses the real
`DrizzleEvidenceStoreRepository` and reads records from PostgreSQL.
`packages/research/tests/evidence-ingestion.integration.test.ts` executes the
real SearchTool-to-ingestion-to-repository path and verifies database readback.

Without a running isolated PostgreSQL service, these explicit integration
commands are blocked. Ordinary `pnpm test` remains a unit-test command; its
PostgreSQL files are skipped when the safety marker is absent so a developer
cannot accidentally write to an unknown database.
