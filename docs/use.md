建议先完成一次**真实研究体验**，再运行自动化验收。以下命令都在项目根目录的 PowerShell 执行。

**1. 安装依赖、准备配置**

先启动 Docker Desktop，然后执行：

```powershell
cd "D:\AI Project\product-scout"

$env:CI='true'
pnpm install --frozen-lockfile

# 仅在没有 .env 时创建，保留已有配置
if (!(Test-Path .env)) {
    Copy-Item .env.example .env
}

# 生成本地用户 ID
node -e "console.log(require('node:crypto').randomUUID())"
```

编辑根目录 `.env`，确认这些配置：

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/product_scout

PRODUCT_SCOUT_OWNER_ID=填写上面生成的UUID

DSH_HOME=.dsh-runtime
DEEPSEEK_API_KEY=填写可用的DeepSeek密钥
DSH_PROVIDER=
DSH_MODEL=

SEARCH_PROVIDER=agent-web-search-mcp
SEARCH_MCP_COMMAND='D:/AI Project/product-scout/.venv-search/Scripts/agent-web-search-mcp.exe'
SEARCH_TIMEOUT_MS=60000

AGENT_TIMEOUT_MS=300000
```

已有 `PRODUCT_SCOUT_OWNER_ID` 时继续使用，不需要重新生成。当前 DSH 使用 `DEEPSEEK_API_KEY`；通用的 `LLM_API_KEY`、`LLM_BASE_URL` 不会自动传入 DSH。

**2. 初始化本地数据库**

以下操作针对上面明确配置的本地开发数据库。已有其他数据库配置时，先确认目标。

```powershell
docker compose -f docker/docker-compose.yml up -d --wait db

node --env-file=.env packages/db/scripts/migrate.mjs

pnpm db:seed-owner
```

预期迁移成功，随后输出：

```text
Local workspace owner is ready.
```

**3. 先单独验证搜索**

```powershell
Test-Path ".venv-search/Scripts/agent-web-search-mcp.exe"

pnpm --filter @product-scout/agent search:smoke "small business inventory software user complaints"
```

预期返回包含 `title`、`url`、`snippet` 的结果，且 `tool.completed` 的 `success` 为 `true`。这个命令不写数据库。

如果可执行文件不存在，按 [README 搜索配置说明](</D:/AI Project/product-scout/README.md:223>)安装现有 MCP 搜索环境。

**4. 启动并体验完整研究**

推荐使用生产构建验证：

```powershell
pnpm build
pnpm --filter @product-scout/web start
```

打开：

[http://127.0.0.1:3000/projects](http://127.0.0.1:3000/projects)

依次操作：

1. 创建项目，例如“小企业库存管理研究”。
2. 输入具体研究目标，例如：  
   **“研究美国小型零售商库存与会计对账中的重复手工工作，比较现有软件、用户投诉和定价，寻找可验证的软件机会。”**
3. Target market 填写 `US small retailers`。
4. 点击 **Start research**，观察六步状态和 Recent activity。
5. 完成后检查报告、机会评分及七项解释、MVP、7 日验证计划。
6. 沿 Finding → Claim → Evidence 查看原始来源，抽查结论是否得到来源支持。
7. 再启动一条研究，点击 **Cancel research**，确认状态变为 `cancelled`。

真实研究会调用模型并产生 API 费用。执行期间保持服务器运行；当前版本不支持重启后恢复任务。证据不足时可能明确失败，不保证每次都产生机会。

**5. 运行自动化工程验收**

在另一个 PowerShell 窗口运行：

```powershell
cd "D:\AI Project\product-scout"

pnpm typecheck
pnpm lint
pnpm test
pnpm build

# 使用 Windows 已安装的 Microsoft Edge
$env:PLAYWRIGHT_CHANNEL='msedge'
pnpm test:e2e

git diff --check
```

浏览器测试主要使用 HTTP fixtures；通过它们不能代替真实模型研究验收。

**6. 运行真实 PostgreSQL 集成验收**

使用独立测试数据库，端口是 `55432`，与开发库 `5433` 分开：

```powershell
pnpm db:test:up

$env:PRODUCT_SCOUT_TEST_DATABASE='1'
$env:TEST_DATABASE_URL='postgresql://product_scout_test:product_scout_test@127.0.0.1:55432/product_scout_test'

pnpm db:test:migrate
pnpm db:test:integration

# 停止测试服务，保留数据卷
pnpm db:test:down

Remove-Item Env:PRODUCT_SCOUT_TEST_DATABASE
Remove-Item Env:TEST_DATABASE_URL
```

上次验收记录是普通测试 **406 通过**、数据库测试 **39 通过**、Playwright **4 通过**，本次以实际执行结果为准。

完整标准见[验收报告](</D:/AI Project/product-scout/docs/v0.1-acceptance.md>)。当前最关键的剩余验证，是通过真实 DSH 完成一次研究，并人工核对来源、结论和评分解释。