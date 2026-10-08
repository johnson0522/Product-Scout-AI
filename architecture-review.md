# Architecture Review: Product Scout AI

## Executive Summary

This document provides a comprehensive architectural review of the Product Scout AI codebase, focusing on the 13 key areas specified: Product Layer/Agent Runtime boundary, DSH coupling, domain dependency direction, database dependency direction, AgentRuntime abstraction, Tool/Skill/Agent separation, security boundaries, agent loop termination, evidence traceability, unnecessary dependencies, TypeScript quality, testability, and future maintainability.

---

## 1. Product Layer / Agent Runtime Boundary

### Finding: CRITICAL - Missing Agent Gateway Implementation

- **File**: `apps/web/app/api/research/route.ts`
- **Problem**: The API route returns 501 Not Implemented - there is no Agent Gateway connecting the Product Layer to the Agent Runtime
- **Why it matters**: Per AGENTS.md, the architecture requires an Agent Gateway to transform runtime events into product events and manage research sessions. Without it, the system cannot execute research.
- **Recommended solution**: Implement the Agent Gateway per docs/architecture.md section 3 - it should handle: create research session, start/resume/cancel research, receive runtime events, transform events.

---

## 2. DSH Coupling

### Finding: MAJOR - Direct DSH Instantiation in Runtime

- **File**: `apps/agent/src/runtime/DeepSeekHarnessPocRuntime.ts:49`
- **Problem**: Runtime directly instantiates `new DeepSeekHarness({...})` - while this is expected for the PoC, there's no factory pattern to abstract this instantiation
- **Why it matters**: Hard to swap runtimes without modifying the core runtime class; makes testing difficult
- **Recommended solution**: Introduce a `AgentRuntimeFactory` or accept `DeepSeekHarness` as a constructor dependency for better testability

---

## 3. Domain Dependency Direction

### Finding: COMPLIANT

- Domain (`packages/domain`) has no external dependencies and is a pure TypeScript package
- All other packages correctly depend on `@product-scout/domain`
- Direction is correct: Domain → Agents → Infrastructure

---

## 4. Database Dependency Direction

### Finding: COMPLIANT

- Database schema properly defined in `packages/db/src/schema.ts`
- Repository interfaces in `packages/db/src/repositories.ts`
- Implementation in `packages/db/src/drizzle-repositories.ts` correctly uses dependency injection via constructor `constructor(private readonly db: Database)`

---

## 5. AgentRuntime Abstraction

### Finding: MAJOR - Runtime Only Partially Implemented

- **File**: `packages/agent-sdk/src/index.ts:126-132`
- **Problem**: The `AgentRuntime` interface defines `resume()` but `DeepSeekHarnessPocRuntime` throws: "DSH SDK 0.2.1-alpha.1 has no resume request"
- **Why it matters**: Resume functionality is required for long-running research; current implementation will fail at runtime
- **Recommended solution**: Either implement resume with checkpointing or document this as a known limitation requiring DSH SDK update

---

## 6. Tool / Skill / Agent Separation

### Finding: MAJOR - Skills Not Implemented

- **Files**: `apps/agent/src/tools/index.ts`, docs/architecture.md
- **Problem**:
  1. Only one tool registered: `product_scout_echo`
  2. No Skill implementations visible in codebase (no `market-research`, `competitor-research`, `opportunity-analysis`)
  3. Tools are registered in DSH patch file, not in TypeScript
- **Why it matters**: Per AGENTS.md, Tool=capability, Skill=methodology, Agent=orchestration - this separation is not visible in code
- **Recommended solution**: Create explicit Skill implementations in TypeScript that the Agent can invoke

---

## 7. Security Boundaries

### Finding: MINOR - Security Documentation Not Enforced in Code

- **Files**: AGENTS.md sections 9-10, docs/architecture.md section 13
- **Problem**: Security constraints (web content untrusted, capability restrictions) are documented but not visible in implementation
- **Why it matters**: No visible input sanitization, tool permissions enforcement, or prompt injection prevention
- **Recommended solution**: Add security middleware or wrapper in Agent Gateway to sanitize external content before passing to agent

---

## 8. Agent Loop Termination

### Finding: MAJOR - Termination Limits Not Visible

- **Files**: AGENTS.md section 13, docs/architecture.md section 11
- **Problem**: MAX_ROUNDS=3, MAX_SEARCHES=30, MAX_SOURCES=100, TIMEOUT=5min documented but not visible in implementation
- **Why it matters**: Agent could run indefinitely without these limits; unbounded loops cost money and could hang the system
- **Recommended solution**: Implement enforcement in DeepSeekHarnessPocRuntime or document that DSH handles these limits

---

## 9. Evidence Traceability

### Finding: COMPLIANT (for what exists)

- Domain model correctly includes Evidence with sourceId, claim, quote, context, relevanceScore, confidenceScore
- EvidenceRepository exists with proper methods
- However, the Evidence → Source → Opportunity chain is not yet exercised since the system doesn't run

---

## 10. Unnecessary Dependencies

### Finding: SUGGESTION

- No unnecessary dependencies observed
- However, empty packages exist: `packages/evidence`, `packages/research` (have no source files, only dist)
- **Recommended solution**: Either implement these packages or remove them from the monorepo

---

## 11. TypeScript Quality

### Finding: MINOR - Some Type Safety Concerns

- **File**: `apps/agent/src/runtime/DeepSeekHarnessPocRuntime.ts:46`
- **Problem**: `private response = ''` uses implicit `string` type
- **File**: `packages/db/src/drizzle-repositories.ts:45-51`
- **Problem**: Error handling uses string interpolation in Error constructor
- **Overall**: Generally good - uses strict mode, interfaces, discriminated unions
- **Recommended solution**: Add explicit typing and consider using neverthrow for Result types

---

## 12. Testability

### Finding: CRITICAL - No Tests

- **Files**: `tests/smoke.test.ts`
- **Problem**: Only a placeholder test that asserts `true === true`
- **Why it matters**:
  - No unit tests for tools
  - No unit tests for skills
  - No unit tests for repositories
  - No integration tests for the gateway
- **Recommended solution**: Add tests per agent-development.md section 9:
  - Unit tests for each tool
  - Workflow tests for each skill
  - Evaluation tests for research scenarios

---

## 13. Future Maintainability

### Finding: MAJOR - Architecture Gaps

1. **Missing Gateway**: No Agent Gateway implementation between API and Runtime
2. **Missing Skills**: No Skill implementations visible
3. **Missing Observability**: No event emission infrastructure beyond DSH notifications
4. **Incomplete API**: Research API returns 501

### Finding: MINOR - Incomplete Package Structure

- `packages/evidence` and `packages/research` exist as empty shells with only dist folders
- No source code in these packages

---

## Summary Table

| # | Finding | Severity | File |
|---|---------|----------|------|
| 1 | Missing Agent Gateway | CRITICAL | `apps/web/app/api/research/route.ts` |
| 2 | No Tests | CRITICAL | `tests/smoke.test.ts` |
| 3 | Resume Not Implemented | MAJOR | `packages/agent-sdk/src/index.ts` |
| 4 | No Skill Implementations | MAJOR | `apps/agent/src/tools/index.ts` |
| 5 | Loop Termination Not Enforced | MAJOR | `apps/agent/src/runtime/DeepSeekHarnessPocRuntime.ts` |
| 6 | Direct DSH Coupling | MAJOR | `apps/agent/src/runtime/DeepSeekHarnessPocRuntime.ts` |
| 7 | Empty Packages | MINOR | `packages/evidence`, `packages/research` |
| 8 | Security Not in Code | MINOR | N/A - documentation only |
| 9 | Minor Type Issues | MINOR | `apps/agent/src/runtime/DeepSeekHarnessPocRuntime.ts` |

### Severity Distribution

| Severity | Count |
|----------|-------|
| CRITICAL | 2 |
| MAJOR | 4 |
| MINOR | 3 |
| SUGGESTION | 1 |

---

## Recommendations Summary

### Immediate Actions (Critical)

1. **Implement Agent Gateway**: Create the gateway layer that connects the Product Layer to AgentRuntime
2. **Add Test Coverage**: Write unit tests for repositories, tools, and skills

### Short-term Actions (Major)

3. **Implement Skills**: Create Skill implementations for market-research, competitor-research, opportunity-analysis
4. **Implement Resume**: Either implement checkpointing or document the limitation
5. **Add Loop Termination**: Implement MAX_ROUNDS, MAX_SEARCHES, MAX_SOURCES, TIMEOUT enforcement
6. **Add Runtime Factory**: Introduce factory pattern for runtime instantiation

### Medium-term Actions (Minor)

7. **Clean Up Empty Packages**: Either implement or remove `packages/evidence` and `packages/research`
8. **Add Security Middleware**: Implement input sanitization for external content
9. **Improve Type Safety**: Add explicit types where implicit types exist

---

*Review Date: 2026-10-07*
*Reviewer: Principal Architect*
