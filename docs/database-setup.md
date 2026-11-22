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
`packages/db/drizzle/` 下的现有迁移（当前为 0000–0008），并记录到
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

迁移完成后还需初始化本地工作区用户：将根目录 `.env` 中的
`PRODUCT_SCOUT_OWNER_ID` 设置为 UUID，然后在仓库根目录执行：

```powershell
pnpm db:seed-owner
```

此命令使用当前 `DATABASE_URL`，仅插入指定的本地用户；重复执行不会覆盖
已有用户。更换数据库或 `PRODUCT_SCOUT_OWNER_ID` 后，应再次执行。
Web 服务不会自动创建用户。只配置 UUID 而未初始化用户时，项目列表可能
正常返回空数组，但创建项目会触发 `projects_owner_id_users_id_fk` 外键约束，
页面显示 `Service unavailable`。生产构建的异常类名可能被压缩（例如 `d`），
不能仅凭类名诊断。初始化完成后无需重新构建或重启 Web，刷新页面即可重试。

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

## 7. Web 已 Ready 但 Product API 返回 AggregateError

Web 启动成功不代表 PostgreSQL 可用。若数据库容器已停止，访问
`localhost:5433` 可能同时对 `::1` 和 `127.0.0.1` 返回 `ECONNREFUSED`，
Node 将两个连接错误合为 `AggregateError`。先检查现有容器，不要删卷或重建数据库：

```powershell
docker ps -a --filter name=product-scout-db
docker start product-scout-db
docker exec product-scout-db pg_isready -U postgres -d product_scout
```

如果 `docker start` 报 `network ... not found`，先检查容器实际使用的网络及数据卷：

```powershell
docker inspect product-scout-db --format '{{json .NetworkSettings.Networks}} {{json .Mounts}}'
docker network ls
```

只有确认该容器原本使用 `docker_default`、且这个网络已不存在时，才恢复同名网络，
移除容器的失效网络引用并重新连接。以下操作保留容器及其原数据卷：

```powershell
docker network create --driver bridge --label com.docker.compose.project=docker --label com.docker.compose.network=default docker_default
docker network disconnect --force docker_default product-scout-db
docker network connect --alias db --alias product-scout-db docker_default product-scout-db
docker start product-scout-db
docker exec product-scout-db pg_isready -U postgres -d product_scout
```

如果网络名称或故障不同，应先诊断，不要直接套用这些恢复命令。

容器恢复且配置正确时，刷新页面即可重试。应用响应仍隐藏数据库细节；
API 返回 `Service unavailable` 也可能有其他原因，不能把所有此类错误
都判定为数据库未启动。新环境的建库和 migration 请按前文执行。

`pnpm --filter @product-scout/web dev` 显式使用 `NODE_ENV=development`，
`start` 显式使用 `NODE_ENV=production`；两者通过跨平台启动脚本加载
根目录 `.env`，并继续绑定 `127.0.0.1`。无需为了切换命令反复修改
共享 `.env`。`start` 使用已有构建；更新应用源码后先运行 `pnpm build`。

## 8. 创建项目时提示 Cross-origin request rejected

浏览器的 Origin 必须与实际访问地址的协议、主机和端口完全一致。
Next.js 14.1 的 NextURL 会将本机回环地址规范化为 `localhost`，因此
API 使用经过本机地址白名单校验的 Host 头还原浏览器访问的 origin，
避免从 `http://127.0.0.1:3000` 提交表单时被误拒绝。
应用不信任 `X-Forwarded-Host` / `X-Forwarded-Proto`，也不会把
`localhost` 与 `127.0.0.1` 作为可互换的浏览器来源放行。

修复源码后需要重新构建并重启 `start` 服务；只刷新仍运行旧构建的服务不会生效。
无需修改 `NEXT_PUBLIC_APP_URL` 或关闭跨站请求校验。
