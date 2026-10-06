
# ADR-003: PostgreSQL

## Status

Accepted

## Decision

Use PostgreSQL as the primary application database.

Use Drizzle ORM.

## Reasons

Product Scout has relational business data:

- users
- projects
- research runs
- sources
- evidence
- opportunities
- validation plans

Relational consistency is more important than introducing a specialized database at V0.1.

## Not Included

Vector database is not required for V0.1.

If semantic search becomes necessary later, it can be introduced based on actual requirements.