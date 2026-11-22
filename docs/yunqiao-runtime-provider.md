# 云桥 GPT Runtime Provider

## 配置

固定使用 DSH `0.2.1-alpha.1` 已安装的官方 `dsh-llm-pi-ai` 扩展，
不升级 DSH，不新增依赖。生产调用链为：

```text
Product -> Gateway -> ResearchWorkflowRuntime -> AgentRuntimeReasoner
        -> DeepSeekHarnessReasoner -> DSH sdk-minimal
        -> dsh-llm-pi-ai / yunqiao / openai-responses
        -> https://api.yunqiao.me/v1/responses
```

根目录 `.env` 的模型配置：

```dotenv
DSH_HOME=.dsh-runtime
DSH_PROVIDER=yunqiao
DSH_MODEL=gpt-6.1-sol
LLM_BASE_URL=https://api.yunqiao.me/v1
LLM_API_KEY=你的云桥密钥
```

`LLM_BASE_URL` 可省略，或填写相同 HTTPS origin；不接受其他域名、路径、
凭证、query 或 fragment。当前只支持本次实际验证的模型 ID。
`DEEPSEEK_API_KEY` 对该路由无效；`LLM_PROVIDER` 不控制路由。
不设置 `DSH_PROVIDER` 时继续使用旧的官方 DeepSeek 路由，绝不自动猜测厂商。
修改本地 `.env` 后重启应用。不要提交密钥或把密钥粘贴到聊天。

子进程仅接收选定路由的密钥及已有系统变量白名单。DSH 的进程目录为
`apps/agent/src/dsh`，SDK session workspace 仍为仓库根目录。禁止在该启动
目录或指定 DSH home 中放 `.env`，避免 DSH 重新加载业务凭证。
根目录业务 `.env` 不需要移除 `DSH_HOME`。

Provider patch 强制 SSE、每次请求 60 秒、stream idle 30 秒、零自动重试。
32,768 context / 8,192 output token 是保守部署限制，不是宣称模型容量。
完整操作还受 Reasoner/Workflow 的既有超时和取消机制约束。

## 验证命令

```powershell
# 已有直接接口检查，不经过 DSH
pnpm --filter @product-scout/agent llm:smoke

# 新增：真实 DSH + Provider + Tool + 生产 synthesis schema
pnpm --filter @product-scout/agent dsh:smoke
```

`dsh:smoke` 会使用少量套餐额度。它启动两个独立 DSH 生命周期：

1. 调用固定加法工具，取得本地随机 receipt，再通过 schema 提交工具回传。
   本地工具核对 receipt 与 sum 后才返回成功。适配器还检查两个工具调用、
   DSH 流式片段和 Product 工具事件。
2. 在明确“没有证据”的诊断输入下，通过实际
   `product_scout_submit_synthesis` 提交空 claims/findings/assessments。
   不虚构任何研究结论，不写 PostgreSQL。

每个操作整体最多 120 秒（其中启动握手最多 60 秒），均在 finally 关闭
owned Harness。诊断 DSH home 使用 `.dsh-runtime/provider-smoke-*`，不与
生产 session 混用；该目录已被 Git 忽略。日志不输出密钥、原始 trajectory
或隐藏推理，仅报告计数、通过状态和失败诊断。

## 真实检查结果（2026-11-21）

已实际执行，通过，退出码 0：

- DSH 初始化选择 `yunqiao / gpt-6.1-sol`。
- 2 个工具调用，17 个文本片段、40 个工具参数片段。
- 本地工具结果随机 receipt 核验成功；结构化结果提取成功。
- 2 个 Product 工具生命周期事件投影。
- 生产 synthesis schema 的空输入提交成功。
- 两个 Harness 生命周期均完成关闭。

验证中发现并修复了启动目录 `.env` 重载冲突和工具模块路径问题。
DSH SDK 返回 idle 不能证明 turn 成功，适配器现额外拒绝失败终态。
适配器还增加覆盖启动、模型与工具循环的整体 deadline，因为 SDK 的 RPC
request timeout 本身不约束后续等待 session idle 的时长。

这证明固定 Provider 与现有结构化 Reasoner 的互通，不代表完整真实研究、
其他三类业务 schema 的真实模型输出质量、PostgreSQL 或浏览器端到端验收。
DSH 日志中的流式片段也不能证明云桥代理没有缓冲。

## 代码与测试

- `src/synthesis/provider.ts`：纯配置校验和路由选择。
- `src/dsh/yunqiao-responses.patch.yml`：官方 Provider 扩展配置，无密钥。
- `src/synthesis/DeepSeekHarnessReasoner.ts`：Provider patch、凭证隔离和失败终态。
- `src/diagnostics/dsh-provider-smoke.ts`、`provider-probe*`：显式开发者验证。
- `tests/dsh-provider.test.ts`：默认路由兼容、四类 Reasoner 注入、错误配置、
  凭证/文件环境隔离，以及已提交结果后的失败/取消/超限处理。
- `tests/provider-probe-tools.test.ts`：真实 probe 实现的参数、receipt 和实例隔离。

以上测试均可离线执行，不能替代上面的真实网络验证。包内路径均相对
`apps/agent`。架构决定见 [ADR-013](decisions/013-yunqiao-responses-provider.md)。

## 工程验证

`pnpm typecheck`、`pnpm lint`、`pnpm test` 通过，全仓 433 个测试通过、
39 个专用 PostgreSQL 测试因安全门禁跳过；Turbo 有 7 个包命中缓存。
Agent 包实际执行 96 个测试通过，本阶段新增 17 个 Provider/工具测试。
新增测试和 probe `.mjs` 还单独通过 ESLint 检查。`pnpm build` 和
`git diff --check` 均通过；build 保留原有 Next.js ESLint plugin 未检测到的
非阻塞警告。本阶段没有数据库 migration 或业务写入，
也没有执行浏览器端到端验收。没有修改依赖版本、lockfile、旧 ADR 或 AGENTS.md。

## 本阶段文件清单

新增：

- `apps/agent/src/synthesis/provider.ts`
- `apps/agent/src/dsh/yunqiao-responses.patch.yml`
- `apps/agent/src/dsh/provider-probe.patch.yml`
- `apps/agent/src/dsh/provider-probe-tools.mjs`
- `apps/agent/src/diagnostics/dsh-provider-smoke.ts`
- `apps/agent/tests/dsh-provider.test.ts`
- `apps/agent/tests/provider-probe-tools.test.ts`
- `docs/decisions/013-yunqiao-responses-provider.md`
- `docs/yunqiao-runtime-provider.md`

修改：

- `apps/agent/src/synthesis/DeepSeekHarnessReasoner.ts`：路由、凭证、环境和终态/超时。
- `apps/agent/src/dsh/synthesis.patch.yml`、`opportunities.patch.yml`、
  `report.patch.yml`、`validation-plan.patch.yml`：按隔离启动目录解析工具模块。
- `apps/agent/package.json`：新增 `dsh:smoke` 命令，保留上一阶段 `llm:smoke`。
- `.env.example`、`README.md`：显式云桥配置和使用说明。
- `docs/architecture.md`、`docs/dsh-integration.md`：Runtime Provider 边界说明。

上一阶段的 Responses 诊断文件和其他用户修改均保留，没有创建 Git commit。
