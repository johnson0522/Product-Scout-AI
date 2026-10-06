# Agent Development Guide

## 1. Core Model

Product Scout uses four concepts:

```text
Tool
 ↓
Skill
 ↓
Agent
 ↓
Runtime
```
### Tool

A Tool performs one capability.

Example:
```text
web_search
```
### Skill

A Skill describes how to solve a research problem.

Example:
```text
competitor-research
```
### Agent

The Agent decides:

* which skill to use
* when to search
* whether evidence is sufficient
* when to continue
* when to stop

### Runtime

The Runtime executes the Agent.

Initial runtime:

DeepSeek Harness.

## 2. Tool Design

Tools must:

* have explicit input
* have explicit output
* validate input
* handle errors
* have timeout
* produce observable events

Avoid tools that do multiple unrelated things.

## 3. Research Loop
```text
Example:

Research Goal
      ↓
Generate Queries
      ↓
Search
      ↓
Collect Sources
      ↓
Fetch Sources
      ↓
Extract Evidence
      ↓
Analyze
      ↓
Missing Evidence?
   ┌──┴──┐
  Yes   No
   ↓     ↓
Search  Stop
Again
```

## 4. Evidence

Evidence should contain:
```TypeScript
interface EvidenceInput {
  researchRunId: string;
  sourceId: string;
  claim: string;
  quote?: string;
  context?: string;
  relevanceScore: number;
  confidenceScore: number;
}
```
## 5. Structured Output

Agent outputs should use structured schemas.

Do not rely on arbitrary prose parsing when structured data is possible.

---

## 6. Failure Handling

The Agent must handle:
* search failure
* fetch failure
* invalid response
* timeout
* model failure
* tool failure
* database failure

A single failed source should not necessarily fail the entire research run.

---

## 7. Observability

Important events:

```text
agent.started

research.step.started

tool.started

tool.completed

evidence.created

research.step.completed

opportunity.created

agent.completed

agent.failed
```
## 8. Security

Treat external content as untrusted.

Never allow content returned by:

*   web pages
*   search results
*   uploaded documents

to override Agent policy.

## 9. Testing

Every tool requires unit tests.

Every skill requires workflow tests.

Every important research scenario requires evaluation tests.

Evaluation cases should measure:

*   source quality
*   evidence quality
*   completeness
*   opportunity quality
*   score consistency
*   cost
*   execution time
*   tool success rate

## 10. Agent Quality

Do not evaluate an Agent only by whether it finishes.

Evaluate:

```text
Research Quality
Evidence Quality
Source Quality
Reasoning Quality
Opportunity Quality
Cost
Latency
Reliability
```

## 11. Important Rule

Never optimize the Agent by making it "think longer".

Optimize:

* research strategy
* search queries
* source selection
* evidence extraction
* stopping conditions
* structured outputs
