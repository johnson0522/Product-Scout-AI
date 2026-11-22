# 云桥 GPT Responses 最小验证

这是开发者手动网络诊断，不是生产 Provider，也不代表 DSH 已支持 GPT。
DSH 继续固定为 `0.2.1-alpha.1`，Product Layer、Gateway 和现有 Runtime 不变。

## 配置与执行

根目录未跟踪的 `.env` 中配置：

```dotenv
LLM_BASE_URL=https://api.yunqiao.me
LLM_API_KEY=你的云桥密钥
```

脚本只允许向 `https://api.yunqiao.me/v1` 发送凭证，固定测试用户指定的
`gpt-6.1-sol`，不替换其他模型、不跟随重定向、不重试。

```powershell
pnpm --filter @product-scout/agent llm:smoke
```

依次验证：

1. `/v1/models` 是否列出该密钥可用的目标模型。
2. 非流式 `/v1/responses` 是否返回完成状态与预期文本。
3. 流式响应是否包含文本 delta 和 `response.completed`。
4. 强制调用测试函数，校验流式参数，在本地执行 `19 + 23`，回传
   `function_call_output`，要求模型确认工具返回的随机校验值。

最多一次模型列表请求与四次模型请求，可能消耗套餐用量。每次请求（包括
读取完整响应）最多 60 秒、一 MiB，最多 2048 输出 token。没有 Search、
数据库操作、shell Tool 或生产研究数据。失败立即停止，后续项目视为未执行。
日志仅含检查状态和有限元数据，不输出密钥、原始响应或隐藏推理。

此检查证明的是 Responses 协议和套餐的能力；即使全部通过，也仍需独立
设计和验证 DSH Provider 适配。SSE 检查验证事件格式与网络分块解析，
不证明上游代理没有缓冲，也不代表产品 SSE 已完成端到端验证。

## 本次真实执行（2026-11-21）

首次 `GET /v1/models` 返回 HTTP 403，云桥错误码 `GROUP_DISABLED`，
消息为“API Key 所属分组已停用”，当时未发起模型调用。随后重新运行时
该错误已不再出现，以下是真实云桥请求结果（不是 mock）：

| 检查 | 结果 | 实际证据 |
| --- | --- | --- |
| 模型权限 | PASS | `/v1/models` 列出 `gpt-6.1-sol` |
| 普通模型调用 | PASS | 完成状态，文本准确返回 `PSC_MODEL_OK` |
| 文本流 | PASS | 3 个文本 delta，收到 `response.completed`，结果匹配 |
| 工具往返 | PASS | 9 个参数 delta，参数校验通过，本地 sum=42，模型准确确认工具返回的随机校验值 |

成功执行共一次模型列表查询、四次模型请求，命令退出码 0。
未读取、修改云桥分组配置，也不推断先前 403 消失的具体原因。
如果未来再次出现 `GROUP_DISABLED`，应核对云桥密钥分组与套餐状态。
不要把密钥粘贴到聊天或提交 Git。

`apps/agent/tests/yunqiao-responses.test.ts` 是无网络 mock 传输测试，
覆盖 SSE 分块/UTF-8/换行、错误与截断、大小限制、分组停用、模型缺失和
工具往返协议。它们不能代替真实云桥验证。

工程检查：`pnpm typecheck`、`pnpm lint`、`pnpm test` 和
`git diff --check` 均通过。全仓测试结果含 416 个通过、39 个专用
PostgreSQL 测试因未配置测试环境跳过；Turbo 有 5 个包命中既有缓存。
Agent 包 79 个测试实际执行通过，其中新增诊断测试 10 个。
本次未执行数据库写入、build 或浏览器端到端验证。

## 文档依据

- [云桥指南](https://www.quya.org/guide)：GPT 优先使用 `/v1/responses`，
  模型权限通过 `/v1/models` 核对。
- [OpenAI Responses 工具调用文档](https://developers.openai.com/api/docs/guides/function-calling)：
  标准 function call / `function_call_output` 协议参考。本次环境读取该文档和
  官方 SDK 源码均遇到网络失败，未据此声称云桥已完整兼容，须以真实检查为准。
