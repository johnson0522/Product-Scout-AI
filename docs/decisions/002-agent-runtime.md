# ADR-002: DeepSeek Harness as Initial Agent Runtime

## Status

Accepted

## Decision

DeepSeek Harness is the initial Agent Runtime.

The application accesses it through:

AgentRuntime

rather than depending directly on DSH internals.

## Reasons

- Agent runtime capabilities
- plugin architecture
- session management
- tool execution
- trajectory
- extensibility

## Risk

DeepSeek Harness is evolving rapidly and its public APIs may change.

Therefore:

```text
Product
   ↓
AgentRuntime
   ↓
DSH
```
must remain a strict boundary.

## Consequence

Replacing DSH in the future should only require implementing another AgentRuntime adapter.