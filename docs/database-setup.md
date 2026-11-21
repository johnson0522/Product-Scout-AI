# 开发数据库创建与启动

项目使用 PostgreSQL + Drizzle。数据库初始化分为两步：先创建数据库，
再运行仓库中的 SQL 迁移来创建业务表。以下命令均在仓库根目录的 PowerShell 中执行。

## 1. 准备配置

需要 Node.js 20.6+、pnpm 和已启动的 Docker。先运行 `pnpm install`。
如果根目录还没有 `.env`，复制 `.env.example`；已有文件请保留其配置。

开发 Compose 的初始账号与当前 `.env.example`、`.env` 对齐：

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/product_scout
```

这组账号只用于本地开发。Compose 中的 Web/Agent 容器通过 `db:5432`
连接同一数据库；宿主机进程使用 `localhost:5433`，Compose 映射为 `5433:5432`。
后续修改账号时，需要同时更新本地 `.env`、Compose 的 `POSTGRES_USER` /
`POSTGRES_PASSWORD`、健康检查和两个应用服务的连接串。

## 2. 确认端口可用

```powershell
Get-NetTCPConnection -State Listen -LocalPort 5433 -ErrorAction SilentlyContinue
```

默认使用宿主机 `5433`，可与监听 `5432` 的本机 PostgreSQL 同时运行。
若 `5433` 也被占用，先确认是否为本项目数据库；如需另选端口，
同时修改 Compose 映射的宿主机端口和 `.env` 中的端口。
容器内 Web/Agent 的连接地址仍然是 `db:5432`。

## 3. 启动 Docker 数据库

```powershell
docker compose -f docker/docker-compose.yml up -d --wait db
docker compose -f docker/docker-compose.yml ps db
docker compose -f docker/docker-compose.yml logs --tail 50 db
```

只启动 `db` 服务即可进行本地数据库开发。PostgreSQL 镜像在数据卷为空时，
根据 `POSTGRES_USER`、`POSTGRES_PASSWORD` 和 `POSTGRES_DB`
自动创建账号及 `product_scout` 数据库。数据保存在 `postgres_data` 命名卷中。

已有数据卷不会因修改 Compose 环境变量而重置账号、密码或重新建库。
已有实例的密码需要使用数据库管理权限修改，随后同步连接配置；不要通过删卷来修复认证失败。

## 4. 创建业务表并验证连接

```powershell
node --env-file=.env packages/db/scripts/migrate.mjs
```

该脚本从进程环境读取 `DATABASE_URL`，通过 Drizzle migrator 按顺序执行
`packages/db/drizzle/` 下的现有迁移（当前为 0000–0007），并记录到
`drizzle.__drizzle_migrations`。重复执行会跳过已记录的迁移。
`--env-file` 显式加载根目录 `.env`；如果当前 shell 已设置同名环境变量，
该变量优先，请确认它指向预期数据库。

迁移只负责表结构，目标数据库必须已存在，连接账号需要有建表权限。
初始化流程使用已提交的迁移文件，无需先生成迁移或运行 `db:push`。
若目标库曾通过其他方式建表，需先核对已有结构和迁移记录，避免直接重复建表。

使用密码认证检查 Docker 数据库及表结构：

```powershell
docker compose -f docker/docker-compose.yml exec db psql -h 127.0.0.1 -U postgres -d product_scout -W -c "SELECT current_database(), current_user, 1 AS connection_ok;"
docker compose -f docker/docker-compose.yml exec db psql -h 127.0.0.1 -U postgres -d product_scout -W -c '\dt public.*'
```

按提示输入数据库密码。容器内检查验证数据库服务；宿主机执行迁移成功，
才能同时确认 `.env` 的认证和宿主机端口映射可用。迁移不创建演示用户或项目数据。
应用同样需要将 `DATABASE_URL` 加载到其服务端进程环境中。

停止数据库并保留数据：

```powershell
docker compose -f docker/docker-compose.yml stop db
```

后续可再次运行第 3 节的启动命令。

## 5. 使用本机已有 PostgreSQL

如果选择复用本机 PostgreSQL，无需再启动 Docker 数据库。
使用该实例的真实账号密码及端口更新 `.env`（本机通常是 `5432`，Docker 默认映射为 `5433`）。
例如，使用有建库权限的 `postgres`
账号创建数据库（需要 PostgreSQL 客户端命令可用）：

```powershell
createdb -h localhost -p 5432 -U postgres -W product_scout
```

如果数据库已经存在，跳过建库。随后执行第 4 节的迁移命令。
若返回 `28P01`，说明 PostgreSQL 已响应但账号密码认证失败，需要先核对实例账号密码，
修改 Compose 文件不会修改本机 PostgreSQL 的密码。

## 6. 独立测试数据库

集成测试使用 `127.0.0.1:55432/product_scout_test`，与开发数据库隔离。
启动、迁移及测试命令见 [PostgreSQL 集成测试](postgres-integration.md)。
不要将集成测试指向开发数据库。
