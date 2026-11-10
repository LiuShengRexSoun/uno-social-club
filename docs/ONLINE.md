# 联机状态与历史实现

**当前 GitHub Pages 发布版提供静态人机游戏和自定义村规，在线匹配、账号登录和好友房暂未开放。** 运行当前 Demo 不需要部署本页描述的旧服务，也不需要创建 Supabase 项目。

后续可将联机改为托管实时服务：Pages 承载静态游戏、浏览器保存档案与近期历史、托管通道处理跨用户匹配与消息。该方向尚不作为本次发布的可用能力。

以下内容保留作旧版 Node / Socket.IO 实现的技术参考，不是当前静态发布步骤。

## 历史 Node 服务

旧实现位于 `server/`：单实例 Node.js / Socket.IO 服务，使用内置 SQLite 存账号和会话。需要 Node.js 22.13+，建议 Node.js 24 LTS。

```sh
npm ci
timeout 24h npm run server
```

默认监听 `0.0.0.0:10889`，允许前端来源 `http://localhost:10888`、`http://127.0.0.1:10888`，数据库位于忽略提交的 `runs/server/uno.sqlite`。历史客户端通过 `/api` 和 `/socket.io` 接口连接；当前静态版不开放该交互。

历史服务环境变量：

- `PORT`：默认 `10889`。
- `HOST`：默认 `0.0.0.0`。
- `ALLOWED_ORIGINS`：允许的前端 origin，以逗号分隔，不含路径或末尾斜线。
- `UNO_DATA_DIR`：SQLite 数据目录，默认 `runs/server`。

从手机或转发浏览器访问旧服务时，需要把实际前端 origin 加入 `ALLOWED_ORIGINS`。在 HTTPS 网页中使用旧服务还需要独立的 HTTPS 域名、支持 WebSocket 的反向代理与持久磁盘。

## 历史部署参考

旧服务可由 `server/Dockerfile` 构建：

```sh
docker build -f server/Dockerfile -t uno-online .
docker run --name uno-online --restart unless-stopped \
  -p 127.0.0.1:10889:10889 \
  -e ALLOWED_ORIGINS=https://YOUR-NAME.github.io \
  -v uno-data:/data/uno uno-online
```

Caddy 反向代理示例：

```text
uno.example.com {
    reverse_proxy 127.0.0.1:10889
}
```

容器使用无特权的 `node` 用户；绑定宿主机目录时需保证 UID 1000 可写。运行单个实例：旧版房间和匹配队列在内存中，服务重启会结束活动对局，账号与七天会话保留在 SQLite。备份数据库时应考虑 SQLite WAL 文件。水平扩容需要共享房间状态和分布式匹配机制。

## 历史行为

- 用户名/密码注册登录；密码使用随机盐和异步 scrypt，持久化会话令牌的哈希。
- 服务端使用共享规则引擎检查动作；玩家只接收自己的手牌和对手的公开牌数。
- 同一账号只保留一个活动连接，第二个连接替换第一个。断线后保留座位 60 秒。
- 45 秒回合超时；根据摸牌状态、强制出摸牌和叠罚牌设置作合法处理。UNO 宣告不重置计时。
- 快速匹配固定经典规则；好友房 2–4 人，由房主在开局前设置规则，开局后使用不可变快照。
- 登录请求按来源 IP 限流，游戏指令按连接限流。反向代理部署时应另行处理共享代理 IP 的限流策略。
- 不含邮件验证、找回密码、账号删除界面、观战、持久排行榜或分布式扩容。

## 历史接口

- `POST /api/auth/register`、`POST /api/auth/login`：接收 `{username,password}`，返回 `{token,user:{id,name}}`。
- `GET /api/me`：`Authorization: Bearer TOKEN`。
- `GET /health`：健康状态和活动连接数。
- Socket.IO 使用 `{auth:{token}}` 认证。
- 指令：`queue:join`、`queue:cancel`、`room:create`、`room:join`、`room:rules`、`room:start`、`room:leave`、`game:action`。
- 事件：`state`（个性化 `GameView`）、`lobby`、`queue`、`server_error`。

历史服务的集成测试验证该旧实现，不代表 GitHub Pages 能运行 Node 或提供跨用户共享存储。当前静态游戏的发布步骤请遵循 [README](../README.md)。
