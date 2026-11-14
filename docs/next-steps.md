# 下一步开发计划 (V0.1 收口)

基于 2026-11-04 的代码审核结果制定。目标是把已建成的 C1/D1/D2/D3 各层组件
接成一条**端到端可运行**的 V0.1 链路，并让 AC-01 ~ AC-15 逐条可验证。

---

## 1. 现状审核结论

### 1.1 已经扎实、不需要重做的部分

| 层 | 状态 | 位置 |
| --- | --- | --- |
| 领域契约与评分 | 完成 | `packages/domain`（`calculateOpportunityScore`、权重表、Finding/Claim 工厂） |
| 证据模型与持久化 | 完成 | `packages/evidence` + `packages/db`（`evidence_store`、事务化 claims/findings 关联表） |
| 搜索边界 | 完成 | `packages/research/src/search.ts`（`SearchTool` → `SearchProvider`，输入校验 + 工具事件） |
| 证据摄取 | 完成 | `packages/research/src/evidence-ingestion.ts`（逐条映射、逐条失败不中断） |
| 溯源与质量 | 完成 | `research-finding-service.ts`、`research-quality.ts`（RQC-001~007，确定性可解释） |
| 事件与 SSE | 完成 | `research-events.ts`、`apps/web/lib/research-events.ts`（Last-Event-ID 游标、重放去重、心跳） |
| 运行时边界 | 完成 | `packages/agent-sdk`（`AgentRuntime` 接口 + `FakeRuntime`） |
| 工作流契约与协调器 | 完成 | `research-workflow.ts`、`research-workflow-coordinator.ts`（D3-A / D3-B） |

### 1.2 关键缺口（按阻塞程度排序）

**G1 — 编排链路断裂（最高优先级）**
存在两条互不连通的路径：

- 路径 A：`DefaultAgentGateway.startResearch` → `DeepSeekHarnessPocRuntime.run`
  → DSH。DSH 里只注册了 `product_scout_echo`（`apps/agent/src/dsh/echo-tool.mjs`），
  没有搜索工具、没有 Skill、没有证据写入。`resume()` 直接抛异常。
- 路径 B：`InMemoryResearchWorkflowCoordinator` + `ResearchWorkflowSearchHandlers`
  → `SearchTool` → `SearchResultEvidenceIngestion` → `EvidenceRepository`。
  前 4 步能真正产出 Evidence，但 `opportunity_analysis` 与 `report_generation`
  是硬编码的 `precondition_failed` 占位。

`AgentGateway` 完全不知道 `ResearchWorkflowCoordinator` 的存在；
`ResearchWorkflowSearchHandlers` 也没有被任何 API 层调用。
**结果是：当前系统既不能真正"完成一次研究"，也不能"产出一次报告"。**

**G2 — 只有 Mock 搜索源**
`MockSearchProvider` 返回固定 `'hvac software'` fixture，零网络请求。
`SEARCH_PROVIDER` / `SEARCH_API_KEY` 在 `.env.example` 中已声明但无代码读取。
真实研究无法开展。

**G3 — 输出层完全缺失**
从 Evidence 到最终交付物的链路没有实现：

- 无 Claim 生成服务（`ResearchFindingService.createClaim` 存在但无人调用）
- 无 Finding 生成服务（`createFinding` 同上）
- 无 Opportunity 生成服务（`DrizzleOpportunityRepository` 已实现，但全项目无写入方）
- 无 `Opportunity` 组装器把 `calculateOpportunityScore` 的结果落库
- 无 Report 生成（`docs/v0.1.md` 要求的 Market Summary / Pain Points / Competitors /
  Market Signals / Opportunities 五段）
- 无 Validation Plan 生成（`validation_plans` 表已建，无写入方）
- `packages/research/src/research-service.ts` 只是一组无人实现的 interface

**G4 — API 层薄**
`AGENTS.md` §18 列出 8 个初始端点，现有 3 个：

| 端点 | 状态 |
| --- | --- |
| `POST /api/projects` | 缺失（`projects` 表与 `DrizzleProjectRepository` 已就绪） |
| `GET /api/projects` | 缺失 |
| `POST /api/research` | 已有 |
| `GET /api/research/:id` | 缺失 |
| `GET /api/research/:id/events` | 已有（SSE） |
| `GET /api/research/:id/report` | 缺失 |
| `GET /api/research/:id/evidence` | 缺失 |
| `POST /api/research/:id/cancel` | 已有 |

另外 `research_steps` 表已建，但**没有 Step 写入仓库**，步骤状态无处落库。

**G5 — 前端是占位壳**
`dashboard/page.tsx`、`projects/page.tsx`、`research/page.tsx` 均为纯静态文字；
`ResearchForm.tsx` 的 submit 带着 `// TODO: Implement research submission`。
全项目**没有任何 `EventSource` 调用**——AC-11"前端展示实时进度"完全没做。
`packages/ui` 有 Button/Card/Input/Badge/Spinner 但未被真正使用。

**G6 — 研究限额未强制**
`MAX_ROUNDS=3 / MAX_SEARCHES=30 / MAX_SOURCES=100 / TIMEOUT=5min` 只写在文档里
（`README.md` §Research Limits、`architecture.md` §11）。代码中无任何强制点：
`ResearchWorkflowFailure` 定义了 `timeout` 类型但协调器不产生它；
`.env.example` 的 `AGENT_MAX_ROUNDS` 等无人读取。
**AC-13"超时被处理"因此无法通过。**

**G7 — Agent Skill / Plugin 是占位**
`dsh/skills/*/index.ts` 三个文件都是 `Placeholder` 常量；
`dsh/plugins/product-research/index.ts` 同理。

### 1.3 架构边界评估

`AGENTS.md` 的核心约束目前**全部守住**，这是本项目最健康的部分：

- ✅ 产品层未直接依赖 DSH 内部 API（只经 `AgentRuntime` 接口）
- ✅ 业务数据在 PostgreSQL、运行时状态在 DSH，未复制
- ✅ 无微服务 / 无向量库 / 无队列 / 无 K8s
- ✅ `cordis.patch.yml` 已禁用 `persistent-bash` 与 `persistent-pwsh`
- ✅ D2 质量规则确定性、不用 LLM 推断
- ✅ 每个新增包都有独立测试

需要留意的是 **G1 的修复方式会决定后续形态**，因此本计划第一阶段先做决策落地。

---

## 2. 已确认的方向决策

| 议题 | 决策 | 理由 |
| --- | --- | --- |
| 编排归属 | **应用层协调器主导**（Coordinator 跑 6 步图并强制限额；DSH 通过 `AgentRuntime` 下沉为 handler 内部的推理引擎） | 符合 `AGENTS.md` §12/§13；D3 已完成的工作不被推翻；限额/超时/幂等在一个可测试的位置收敛 |
| 搜索数据源 | **先接真实 Provider**（`SearchProvider` 保持不变，新增真实实现；`Mock` 降级为测试替身） | AC-03/AC-04 的前提；否则全链路跑通也无产品价值 |

### 2.1 目标形态

```text
POST /api/research
   ↓
AgentGateway.startResearch(runId)
   ↓  (新建：WorkflowRunService)
ResearchWorkflowCoordinator (应用层，6 步图)
   ├─ market_understanding   ─┐
   ├─ pain_point_research    ─┤  SearchTool → SearchProvider(真实)
   ├─ competitor_research    ─┤  → SearchResultEvidenceIngestion → evidence_store
   ├─ market_signal_research ─┘
   ├─ opportunity_analysis   → Claim → Finding → Opportunity → opportunity_scores
   └─ report_generation      → Report + validation_plans
   ↓
AgentRuntime (DSH) 作为 handler 内部的推理引擎：
  抽取 Claim / 生成 Opportunity / 写报告正文
   ↓
ProductEvent (持久化) → SSE → 前端实时进度
```

关键点：**协调器是唯一编排者**，DSH 不再自行编排，避免两条路径再次分叉。

---

## 3. 分阶段计划

实施进度（2026-11-14）：E1 已加入真实 Search Provider。D3-E 至 D3-F 已完成
Finding、Quality、Opportunity、Report 和 ValidationPlan 的完整应用层链路；
D3-G-A 已把生产 Web Gateway 切换到该六步 Workflow，并接入整体 timeout 与
固定四步 Search/Source 预算。本文现状审核保留为实施前基线；ResearchStep
持久化、运行中增量事件发布和进程重启恢复仍待实现。

E1 验证：`pnpm typecheck`、`pnpm test`、`pnpm lint` 均通过；新增 82 个测试，
包含 HTTP fixture、配置/工厂、证据摄取联通与 Node CLI 加载回归。
现有 26 个 PostgreSQL 集成用例因未配置专用测试库而跳过；未执行真实供应商 API 联调。

每个阶段独立可交付、可测试，遵循 `AGENTS.md` §25
（Specification → Plan → Implementation → Test → Review → Commit）。

### 阶段 E1 — 真实搜索 Provider（对应 G2）

**目标**：AC-03 / AC-04 的数据基础。

1. `packages/research/src/search.ts` 保持 `SearchProvider` 接口不变。
2. 新增 `packages/research/src/search-providers/`：
   - `HttpSearchProvider`：基于 `fetch` 的通用实现，读取
     `SEARCH_PROVIDER` / `SEARCH_API_KEY` / `SEARCH_BASE_URL`，
     覆盖 Brave / Tavily 两种响应形状的适配。
   - 明确的超时（默认 10s）、错误分类（`rate_limited` / `unauthorized` /
     `network` / `invalid_response`）、响应体大小上限。
3. `apps/agent/src/search/` 保留 `MockSearchProvider` 作为测试替身；
   新增工厂按 env 选择实现。
4. **安全**：外部内容一律作为不可信数据处理，不进入 system prompt 的指令位。
5. 测试：用 `vi.stubGlobal('fetch')` 的 fixture 测试覆盖
   正常响应、429、401、非 JSON、超时、超大响应体。

**DoD**：`pnpm typecheck && pnpm test && pnpm lint` 通过；
`SEARCH_PROVIDER` 未配置时明确报错而非静默降级到 Mock。

### 阶段 E2 — 编排落地与限额强制（对应 G1、G6）

**目标**：一次研究能被真正驱动完，且受限于文档承诺的预算。

1. 新增 `packages/research/src/research-workflow-runner.ts`：
   - 把 `ResearchWorkflowSearchHandlers` + 后续新 handler 组装成完整 registry
   - 由 `AgentGateway` 调用，替代当前直接 `runtime.run()` 的路径
2. **限额强制**（新建 `ResearchBudget` 值对象，注入 handler）：
   - `maxSearches`：跨全部 step 累计，`SearchTool` 执行前检查
   - `maxSources`：累计入库 Evidence 数
   - `maxRounds`：同一 step 的重试轮次（当前 `maxAttempts=1`，保持默认，
     但 runner 层拦截超限）
   - `timeoutMs`：整体 deadline，Coordinator 每步前后检查，
     超时产出 `kind: 'timeout'` 失败并把 run 置为 failed
   - 全部从 `config` 读取，与 `.env.example` 已有的
     `AGENT_MAX_ROUNDS/AGENT_MAX_SEARCHES/AGENT_MAX_SOURCES/AGENT_TIMEOUT_MS` 对齐
3. **Step 持久化**：新增 `ResearchStepRepository` + `DrizzleResearchStepRepository`
   （`research_steps` 表已存在，仅缺写入方），每次 step 状态变化写库，
   并发 `research.step.started` / `research.step.completed` 产品事件。
4. **DSH 作为推理引擎**：新增 `AgentRuntimeReasoner` 端口，
   在 `opportunity_analysis` / `report_generation` handler 内部使用，
   而不是让 DSH 自行编排。DSH 侧需能拿到 session（当前
   `research-workflow-search-handlers.ts` 用 `research-run:${id}` 占位，
   改为真实 session 绑定）。
5. **取消联动**：`cancelResearch` 同时取消 Coordinator 与 AgentRuntime，
   避免协调器继续跑而 runtime 已停。

**DoD**：单元测试覆盖"达到 maxSearches 时拒绝第 N+1 次搜索""超时产出
timeout 失败""取消后下游步骤为 cancelled"；集成测试跑通一次完整 6 步
（`opportunity_analysis` 与 `report_generation` 可用 stub handler）。

### 阶段 E3 — 证据到洞察的推理层（对应 G3 前半）

**目标**：AC-05 → AC-08 的实体产出。

1. 新增 `packages/research/src/claim-extraction.ts`：
   - 输入：一个 step 产出的 Evidence 列表 + step 类型
   - 输出：结构化 Claim（文本 + evidenceRefs）
   - 依赖 `AgentRuntimeReasoner`，由 LLM 抽取；
     **输出必须是结构化 schema，不解析自由散文**（`agent-development.md` §5）
2. `ResearchFindingService.createClaim` / `createFinding` 接入实际调用方。
3. 新增 `packages/research/src/opportunity-service.ts`：
   - 把 Claim/Evidence 聚类成 Opportunity 草案
   - 调用 `calculateOpportunityScore` 得到 7 维评分与 total
   - 通过 `DrizzleOpportunityRepository` 落库（表与仓库已就绪）
   - 每个评分维度必须带可解释理由（`AGENTS.md` §15）
4. **质量闸门**：opportunity_analysis 产出后调用
   `ResearchQualityAssessmentService`，`status !== 'sufficient'` 时
   产出 `requiresHumanReview` 标记而非静默通过。
   D2 目前要求调用方显式提供 relation/classification——
   本阶段需定义由谁产出这组分类（建议由推理层一并产出并落库，
   使 D2 保持"纯函数、不做推断"的性质）。
5. **可复现性**（AC-09）：同一 Evidence 集合 + 同一评分输入 →
   同一 total。评分函数已是纯函数，需保证上游产出的评分输入稳定且被持久化。

**DoD**：`createClaim` / `createFinding` / Opportunity 落库有单测覆盖；
"无 Evidence 支撑的 Claim 被拒绝"的行为有测试；同一输入两次评分 total 相等有测试。

### 阶段 E4 — 报告与验证计划（对应 G3 后半）

**目标**：AC-08 的产物是"研究报告 + 7 天验证计划"，而不是数据库里的几行记录。

1. 新增 `packages/research/src/report-service.ts`：
   - 按 `docs/v0.1.md` §3 输出五段结构：
     Market Summary / Pain Points / Competitors / Market Signals / Opportunities
   - Pain Point 条目含 description、affected users、frequency、evidence、confidence
   - Competitor 条目含 product、target users、pricing、core features、
     positioning、customer complaints、weaknesses
   - 每个 Opportunity 含 title、target customer、problem、evidence、solution、
     why now、monetization、MVP、score、confidence
   - **报告中的每个关键主张必须可回溯到 evidence id**（AC-10）
2. 新增 `packages/research/src/validation-plan-service.ts`：
   - 生成 7 天计划（Day1 问题访谈 … Day7 决策），落库到 `validation_plans`
   - 需要补 `ValidationPlanRepository` 接口 + Drizzle 实现
3. 定义 `Report` 的存储形态：建议新增 `research_reports` 表（jsonb 正文 +
   `research_run_id`），保持与其他表风格一致；迁移文件走 drizzle-kit generate。
4. **不暴露隐藏推理**（`AGENTS.md` §16）：报告只含结论、证据引用、置信度。

**DoD**：报告生成的单测用固定 Evidence fixture，断言输出结构完整且
每条 claim 都能解析到存在的 evidence id；`validation_plans` 落库有集成测试。

### 阶段 E5 — API 补全（对应 G4）

**目标**：AC-01 / AC-02 可用，AC-11/AC-15 的数据面齐全。

1. 补齐 `AGENTS.md` §18 全部 8 个端点：
   - `POST /api/projects` / `GET /api/projects`
   - `GET /api/research/:id`（run 详情 + steps + 状态）
   - `GET /api/research/:id/report`
   - `GET /api/research/:id/evidence`
2. 每个 handler 沿用现有 `createXxxHandler(resolveDeps)` 工厂模式，
   便于单测注入假依赖（沿用 `apps/web/tests/` 现有风格）。
3. 输入校验沿用 `parseCreateResearchInput` 的显式类型检查风格。
4. 错误映射：404 / 400 / 409 / 502，与现有 cancel handler 保持一致。
5. 报告与证据端点需支持"run 尚未完成时返回进行中状态"而非 404。

**DoD**：每个新端点有 handler 单测（成功 / 非法输入 / 运行不存在）；
不引入认证（V0.1 未要求，`AGENTS.md` §20 只列 users 表）。

### 阶段 E6 — 前端工作台（对应 G5）

**目标**：AC-11 真正成立。

1. `apps/web/app/projects/page.tsx`：项目列表 + 新建项目（调 `POST /api/projects`）
2. `apps/web/app/research/page.tsx`：研究表单 + 运行列表
3. 新增 `apps/web/app/research/[id]/page.tsx`：研究工作区
   - `EventSource` 订阅 `/api/research/:id/events`
   - 展示 step / tool / evidence 进度流
   - 完成后展示报告、机会与评分、验证计划
   - 支持取消按钮（调 `POST /api/research/:id/cancel`）
   - **断线重连必须携带 `Last-Event-ID`**（服务端已支持，AC-15）
4. `ResearchForm.tsx` 去掉 TODO，接真实 API
5. 复用 `packages/ui` 的组件；Tailwind + shadcn/ui 风格保持一致
6. 业务逻辑不放 React 组件内（`AGENTS.md` §17）：
   SSE 客户端抽到 `apps/web/lib/research-stream.ts`

**DoD**：Playwright 用例覆盖"提交研究 → 看到进度流 → 看到报告"
（`playwright.config.ts` 已存在，需确认是否已有 e2e 目录）。

### 阶段 E7 — Skill / Plugin 实体化与安全收口（对应 G7）

1. `dsh/skills/market-research`、`competitor-research`、`opportunity-analysis`
   从 placeholder 改为真实方法论文本 + 提示结构。
   注意：在阶段 E2/E3 的架构下，Skill 描述的是**编排器内部**各 step 的方法论，
   而非 DSH 自主编排。
2. `dsh/plugins/product-research/index.ts` 实体化或明确删除（若确认不被使用，
   删除比留占位更符合 §22 依赖纪律）。
3. 安全复核（`AGENTS.md` §9）：
   - 确认 DSH profile 中除已禁用的 bash/pwsh 外无其他可执行副作用的工具
   - `web_fetch` 类工具（未来）必须有域名/大小/超时限制
   - 确认注入的网页内容不会影响 system 规则与工具权限
4. 补 `AGENTS.md` §11 要求的 `web_fetch` 工具边界（当前项目完全没有）
   —— 若 V0.1 决定不做，需在文档中显式记录为范围外。

### 阶段 E8 — 收尾：AC 对照表与文档同步

1. 逐条核对 `docs/v0.1.md` §5 的 AC-01 ~ AC-15，产出一张
   "验收项 → 验证方式 → 证据"对照表，写入 `docs/v0.1.md`。
2. 同步 `docs/architecture.md`：补 E1~E7 各阶段的边界说明，
   明确"协调器主导、DSH 下沉为推理引擎"这一最终形态。
3. 明确未实现项（如 `web_fetch`、认证、真实 DSH resume）的显式范围声明，
   遵守 `AGENTS.md` §8。
4. 确认所有工作已提交（当前 D3-A/B/C 三个新文件仍是 untracked）。

---

## 4. 建议的执行顺序与依赖

```text
E1 (真实搜索)
  ↓
E2 (编排落地 + 限额)  ← 可与 E1 并行开发（用 Mock 联调）
  ↓
E3 (推理层)  ← 依赖 E2 的 handler 契约
  ↓
E4 (报告 + 验证计划)  ← 依赖 E3 的 Opportunity 产出
  ↓
E5 (API)  ← E3/E4 的契约确定后即可并行
  ↓
E6 (前端)  ← 依赖 E5
  ↓
E7 (Skill/安全)  ← 全程可并行
  ↓
E8 (AC 对照 + 文档)
```

---

## 5. 风险与注意事项

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| DSH SDK 为 `0.2.1-alpha.1`，`resume()` 未实现且会抛异常 | 高 | 阶段 E2 明确不依赖 `resume`；调研限制由协调器承担；升级 SDK 需单独 ADR |
| 推理层引入 LLM 后，"同一输入同一分数"（AC-09）可能被破坏 | 高 | 评分**输入**持久化后再用纯函数计算 total；不让 LLM 直接输出 total |
| 真实搜索有配额与速率限制 | 中 | 限额强制在 E2 落地后自然生效；429 归类为可重试失败 |
| 工作流协调器是进程内的，重启丢失状态 | 中 | V0.1 可接受（`AGENTS.md` §28 不为理论规模优化）；但需在文档写明"E2 in-memory，不承诺 exactly-once" |
| `evidence` 旧表与 `evidence_store` 并存造成困惑 | 低 | E3 完成后旧表若确实无人使用，提交一次清理 ADR |
| 每个阶段都在扩大改动面 | 中 | 严格按 `AGENTS.md` §26 小提交，每阶段独立可回滚 |

---

## 6. 立即可执行的第一步（建议从 E1 开始）

```
1. 确认 SEARCH_PROVIDER 选择（建议 Brave：免费额度够 V0.1 验证）
2. packages/research/src/search-providers/http-search-provider.ts
3. packages/research/src/search-providers/errors.ts（错误分类）
4. packages/research/tests/http-search-provider.test.ts（fetch fixture）
5. .env.example 补 SEARCH_BASE_URL / SEARCH_TIMEOUT_MS
6. pnpm typecheck && pnpm test && pnpm lint
```

同时建议把当前未提交的 D3-A/B/C 三个源文件与三个测试文件补一次提交
（`feat: add research workflow contract, coordinator, and search handlers`），
让 E1 之后的提交保持干净。
