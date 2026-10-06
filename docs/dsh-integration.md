# DeepSeek Harness Integration

本文基于 DeepSeek Harness 官方仓库 `master` 在 2026-10-03 的提交
`5badb15009ae1756c3afe0ae0cef1faafc290ccc`，以及同一提交中的公开 README、包 README、TypeScript 源码和 Cordis 教程。该项目当前版本是 `0.2.1-alpha.1`，官方明确将其标记为 Developer Preview，并警告会发生 breaking changes。

## 1. 当前架构

DSH 的公开描述是 “Everything is a Plugin”。运行时由 Cordis Context 装载插件；Agent、Session、Tool、Skill、模型适配器、持久化和 Web 能力都是可替换的插件/服务。

官方提供两种使用方式：

- `npx @deepseek-ai/dsh web` 启动 Web profile。
- 源码 checkout 使用 `pnpm install`、`pnpm run build`、`pnpm dsh web`。

对于外部 TypeScript 程序，当前推荐的公开边界是 `@deepseek-ai/dsh-sdk-client`。它启动同版本 `@deepseek-ai/dsh` 子进程，选择 `sdk` 或 `sdk-minimal` profile，并通过 stdio 上的 newline-delimited JSON-RPC 驱动 runtime。SDK server 由 `@deepseek-ai/dsh-sdk-jsonrpc-server` 插件提供。

Product Scout 采用以下边界：

```text
Product Layer
    -> Product Scout AgentRuntime
    -> @deepseek-ai/dsh-sdk-client
    -> dsh --profile sdk-minimal
    -> Cordis plugin composition
```

`packages/agent-sdk` 保持纯领域抽象，不导入任何 DSH 包。

## 2. Product Scout 接入方式

本次 PoC 位于 `apps/agent`，只验证 runtime 边界：

- `DeepSeekHarnessPocRuntime` 持有一个官方 `DeepSeekHarness` client。
- 启动 profile 时加载一个本地 Cordis patch。
- patch 禁用 `sdk-minimal` 默认的 persistent shell，并插入 `product_scout_echo` 测试 tool。
- PoC prompt 要求 Agent 调用该 tool，并输出最终响应。
- adapter 只将 DSH 的 session notifications 映射成 Product Scout `AgentEvent`，不把 DSH 对象泄漏到 Product Layer。

PoC 不启用 Web、数据库、SSE、完整 Research Agent 或 DSH trajectory 持久化。

## 3. DSH 与 AgentRuntime 映射

| Product Scout | 当前 DSH SDK 映射 | 结论 |
| --- | --- | --- |
| `createSession` | 本地生成 Product Scout session id；DSH 在第一次 `session/prompt` 时按该 id 创建 session | adapter 行为 |
| `run` | `DeepSeekHarness.run(input, { sessionId, onNotification })` | 公开稳定边界 |
| `resume` | 当前 SDK 没有 resume request；抛出明确的 unsupported error | 不伪造 API |
| `cancel` | 协议没有 per-session/per-prompt cancel；PoC 关闭整个 owned runtime | 粗粒度降级 |
| `getTrajectory` | 返回 adapter 保存的 Product Scout 事件投影 | 不返回完整 DSH log |

SDK 的 `run()` 返回 `RunResult { sessionId, finalResponse, events, notifications }`。其中 `finalResponse` 是该 activity interval 结束时最后一个 root-session assistant message，不是协议层为某个 prompt 分配的独立 response。

## 4. 稳定边界与高风险 API

### 相对稳定的边界

- npm 包 `@deepseek-ai/dsh-sdk-client` 的根导出：`DeepSeekHarness`、`HarnessClient`、`HarnessSession`、`RunResult`、通知订阅和 typed errors。
- SDK JSON-RPC 方法：`initialize`、`session/prompt`、`shutdown`。
- 公开通知方法：`session.event`、`session.status`、`subagent.started`、`subagent.finished`。
- 官方 Cordis plugin 形状：模块导出 `apply(ctx)`，可选 `name`、`inject`；工具通过 `ctx.tools.register(...)` 注册。

### 高风险内部 API

- `@deepseek-ai/dsh-session` 的完整事件日志、持久化格式和内部 projection。
- Cordis service 的具体字段、插件 row id、profile patch 的内部组成。
- `dsh-agent`、`dsh-agent-loop`、LLM adapter 的直接调用方式。
- Web UI、Web profile 和未承诺兼容性的内部 notification payload 扩展。
- `.agents/notes` 中的设计记录。它们是实现背景，不等同于 public API。

因此 Product Scout 只依赖 SDK client 和自身 adapter；升级时不直接依赖上述内部包。

## 5. Session 与 ResearchRun

PostgreSQL 的 `ResearchRun.agentSessionId`（或等价业务字段）只保存 DSH session id。DSH 负责 session runtime state 和原始 append-only log；Product Scout 负责 ResearchRun 状态、研究步骤、Evidence、Opportunity 和报告。

当前 SDK 的 session handle 是 `harness.session(sessionId)`，并不会在调用 handle 时发生 wire 请求；第一次 `run()` 才会让 server 为该 id 创建 Agent/Session。这也是 adapter 在 `createSession` 阶段只建立本地映射的原因。

不要把完整 DSH JSONL/session trajectory 复制到 PostgreSQL。需要展示给产品用户的内容应通过有限的 `AgentEvent` 投影或业务结果保存。

## 6. Tool 映射

官方 Cordis 教程的当前写法是：

```ts
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'example',
    description: '...',
    parameters: { /* explicit schema */ },
    output: { schema: /* explicit schema */, render: /* pure renderer */ },
    async execute(args) { /* deterministic capability */ },
  }))
}
```

PoC 的 `product_scout_echo` 遵循该公开模式。未来 `web_search`、`web_fetch`、`source_store`、`evidence_store` 应分别作为小而可测试的 tool/plugin 注入；不能把这些能力直接写进 Product Layer。

## 7. Skill 映射

当前 DSH Skill 系统由 `@deepseek-ai/dsh-skill` registry、provider（例如 `dsh-skill-filesystem`）和 model-facing consumer `dsh-tool-skill` 组成。runtime skill 可以通过 `ctx.skills.register(...)` 注册；外部来源使用 `ctx.skills.registerProvider(...)`。Skill 是说明/方法论，不是 Tool capability。

Product Scout 的 `market-research`、`competitor-research`、`opportunity-analysis` 应作为独立 Skill 内容提供。PoC 不加载任何 Skill，以便只验证 runtime/session/tool 边界。

## 8. Event 映射

DSH Session 的官方事件词汇包含 `tool/call`、`tool/result`、`assistant/message`、`turn/start`、`turn/end` 等。adapter 当前只投影：

| DSH 事件 | Product Scout 事件 |
| --- | --- |
| adapter 开始 `run()` | `agent.started` |
| `tool/call` | `tool.started` |
| `tool/result` | `tool.completed` |
| `run()` 正常返回 | `agent.completed` |
| `run()` 抛错 | `agent.failed` |

`tool/result` 通过其 `message.toolCallId` 与之前的 `tool/call.callId` 关联；tool 名称保存在 adapter 的短期 map 中。DSH SessionEvent envelope 没有统一的 wall-clock timestamp，因此 Product Scout 的 `occurredAt` 是 adapter 观察/投影时间，不应被当作 DSH 原始事件时间。

`research.step.*`、`evidence.created`、`opportunity.created` 只有在未来 Research Agent 明确产生相应业务事件后才映射，不能从普通 assistant prose 猜测。

## 9. Web subsystem

DSH Web 能力不是 SDK client 的内建方法，而是独立的 Cordis capability family：`dsh-web` service、search/fetch provider 和 `dsh-tool-web` model-facing tools。当前官方支持 DeepSeek、Exa、Perplexity search provider，以及 anonymous HTTP fetch provider；工具结果明确标记 external web content 为 untrusted data。

Product Scout PoC 不加载 Web subsystem。正式接入时必须把 web provider、timeout、result caps 和 untrusted-content 安全边界放在 Agent Runtime/plugin 层。

## 10. API 变化处理

DSH 是快速演进的 Developer Preview。升级策略：

1. 固定并记录 `@deepseek-ai/dsh-sdk-client` 与 `@deepseek-ai/dsh` 的精确版本/commit。
2. 只在 `apps/agent` 的 adapter 中改 DSH 依赖；不把 DSH 类型传播到 `packages/agent-sdk`。
3. 每次升级先运行 SDK client、Cordis tool registration 和 PoC smoke test。
4. 将 SDK wire protocol、通知 payload 和 profile patch 视为 compatibility checks；失败时让 adapter 明确报错。
5. 继续保留 `AgentRuntime` 作为替换边界，禁止 Product Layer 依赖 DSH 内部服务。
6. 不把 undocumented internals 当作 fallback；若公开 API 移除，暂停 adapter 能力并记录 ADR/升级说明。

## 11. PoC 运行

安装依赖后，需要 Node.js 22.19+ 和 DeepSeek API key：

```powershell
$env:DEEPSEEK_API_KEY = '...'
pnpm install
pnpm --filter @product-scout/agent poc
```

成功时 stdout 返回 JSON，至少包含 `sessionId`、`finalResponse` 和 `toolCalls`。SDK 子进程 stdout 保留给 JSON-RPC；诊断信息应在 stderr。当前协议没有中途取消或 per-prompt result，因此这些能力不在 PoC 中宣称。

## 官方依据

- [官方仓库 README（固定提交）](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/README.md)
- [`@deepseek-ai/dsh-sdk-client` README](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/sdk/client/README.md)
- [`@deepseek-ai/dsh-sdk-client` API source](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/sdk/client/src/api.ts)
- [SDK protocol README](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/sdk/protocol/README.md)
- [Cordis first plugin tutorial](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/cordis-tutorial/01-first-plugin.md)
- [Cordis tool tutorial](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/cordis-tutorial/07-into-the-harness.md)
- [Skill registry README](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/skill/skill/README.md)
- [Web subsystem README](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/web/README.md)
