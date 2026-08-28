# GlitchTip 错误监控(自托管)

Runbi 的错误遥测后端,Sentry 协议兼容,自托管免费、无事件上限,私有化部署直接打进交付包。

## 启动

```powershell
cd infra/glitchtip
docker compose up -d
```

容器:db(postgres)+ redis + web(:3000)+ worker(celery)。首次启动后迁移自动执行需手动触发一次(镜像新版不自动迁移):

```powershell
docker exec glitchtip-web-1 ./bin/run-migrate.sh
```

默认管理员(仅本地开发):`admin@runbi.local` / `runbi-admin-pwd` → UI: http://localhost:3000

## Runbi 端接入(已完成)

桌面端用官方 `sentry` crate,DSN 从环境变量读取,**默认关闭、opt-in 启用**(隐私红线,P0-3 同款):

```powershell
$env:RUNBI_GLITCHTIP_DSN = "http://<public_key>@localhost:3000/<project_id>"
cargo run   # 桌面端启动即开启上报
```

冒烟测试(需 GlitchTip 运行中):

```powershell
$env:RUNBI_GLITCHTIP_DSN = "http://<public_key>@localhost:3000/<project_id>"
cargo test --release -- --ignored
```

## 私有化部署

把本目录 compose 打包给客户,DSN 换成客户内网地址即可——客户端代码零改动(Sentry 协议兼容的核心价值)。生产环境必须更换:`SECRET_KEY`、`POSTGRES_PASSWORD`、管理员密码。

## 已知注意点

- 镜像新版入口在 `/code/bin/`(run-migrate.sh / run-worker.sh),旧文档的 `./run.sh` 已失效
- 首次启动必须手动跑一次迁移,否则建项目会报 `relation does not exist`
- GlitchTip 的事件经 celery worker 异步落库:**compose 必须包含 worker 服务**,否则 store 接口返回 200 但事件永远躺在队列里(UI Issues 恒 0)

## 验证记录(2026-08-29)

三条上报路径实测全部落库(事件计数 4,三方独立验证):

| 路径 | 事件 | 验证人 |
|---|---|---|
| curl 原始 Sentry store 协议 | `13e5bd74` | LobsterAI |
| Rust SDK 冒烟测试(`sentry` crate,`cargo test -- --ignored`) | `e8dc719b` | LobsterAI |
| 扩展端 `telemetry.ts`(makeFetchTransport,MV3 SW,opt-in) | `dafc4f09` | Agent_F75E |

扩展端集成见 commit `36945c1`(telemetry.ts + options UI 开关,DSN 存 chrome.storage,默认关)。
