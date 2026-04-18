# Web UI Troubleshooting（Worker Web Canvas / Debug Shell）

本文件总结 Worker 同源托管的 Web UI（`/`）与 Debug Shell（`/debug/shell`）在本地、内网（LAN）与 SSH tunnel 场景下的**常见问题、根因与调试方法**。

如果你遇到的是 Playwright / CI 的失败排查，请先读 `docs/DEBUGGING.md`（本文件更偏向“Web UI 运行态/联调”问题）。

---

## 1. 心智模型（先搞清谁是 owner）

- **Worker 是 durable truth owner**：SQLite 与副作用（session/worktree/etc）由 Worker 拥有；Desktop/Web/CLI 都是 client，通过 control surface（`/invoke + /events + /pty`）读写。
- **Web UI 不是“另一个后端”**：浏览器侧只是一个 runtime adapter，所有写入都必须走 Worker 的 command；同步靠 `snapshot + events`。
- **Dev 模式可能有两套前端资源来源**：
  - Vite dev server（`ELECTRON_RENDERER_URL`）——有 HMR，但只适合 loopback 访问。
  - Worker 同源托管的 build 产物（`out/renderer`）——无 HMR，但适合 LAN/远端访问。

---

## 2. 快速检查清单（90% 的问题在这里）

1) **确认连接的是同一个 Worker**

- 看 Worker stderr 日志：`[opencove-worker] web ui: http://<host>:<port>/`
- 若日志显示：`[opencove-worker] web ui: disabled`，说明 Web UI 未开启（Desktop 场景请在 Settings → Experimental → Worker Web UI 中开启）。
- Desktop 的 Settings 面板里显示的端口，应与 Worker 日志一致。

2) **确认鉴权模式**

Worker 启动日志会提示：

- `auth required (use Authorization: Bearer <token> ...)`

常见路径：

- **loopback（本机）**：Desktop 打开的 Web UI 通常会走一次性 `/auth/claim` ticket 换 cookie session。
- **LAN Access 开启后**：必须走 `/auth/login` 输入 Web UI 密码（cookie session）。
- **CLI/脚本**：用 `Authorization: Bearer <token>` 调用 `/invoke`。

3) **确认 Web UI 静态资源是否同源**

打开浏览器 DevTools → Network：

- 期望看到：`/web.html` + `/assets/web-*.js`（同源）。
- 如果看到：`/@vite/client`、`/@react-refresh`、`/web-main.tsx`（且为跨域），基本就是 dev origin + CORS。

4) **Dev + LAN 场景必须有 build 产物**

LAN host 在 dev 模式下会回落到 `out/renderer`，所以：

- 修改 Web UI 后，需要先跑 `pnpm build`，再用平板/其他设备刷新。

---

## 3. 常见症状 → 根因 → 解决办法

### A) 内网打开白屏（CORS / Vite HMR）

**症状**

- Console 出现：`Origin ... is not allowed by Access-Control-Allow-Origin`
- Network 有：`@vite/client` / `@react-refresh` / `web-main.tsx`

**根因**

页面从 `http://<LAN-IP>:<workerPort>/` 打开，但 HTML 指向 `ELECTRON_RENDERER_URL`（Vite dev server）。在 LAN origin 下会变成跨域加载，Vite dev server 默认会拦截 CORS/HMR，导致白屏。

**解决办法**

- 在本机用 loopback 打开：`http://127.0.0.1:<port>/`（保留 HMR）。
- 或者先 `pnpm build`，再用 LAN IP 打开（Worker 会提供同源 build 产物）。

**如何确认修好了**

LAN 打开时 Network 不应再出现 `@vite/client` / `@react-refresh`。

---

### B) 打开提示 “bundle not found” / 503

**症状**

- 页面文本提示 Web bundle 不存在（或返回 503）

**根因**

worker-only 形态启动时找不到 `out/renderer` 的 build 产物（未执行构建）。

**解决办法**

```bash
pnpm build
```

---

### C) 401 / “token required” / `/invoke` 调不通

**症状**

- Worker 日志提示 `auth required`
- 浏览器里调用 `/invoke` 返回 401/403

**根因**

- `/invoke` 需要 bearer token 或 cookie session；但浏览器页面本身无法直接设置 `Authorization` header（尤其是普通页面跳转场景）。

**解决办法**

- 用 Desktop 的 `Open Web UI` 打开（会完成 cookie session 建立）。
- LAN Access 场景：打开 `http://<LAN-IP>:<port>/` 后按提示进入 `/auth/login` 输入密码。
- CLI/脚本：使用 `Authorization: Bearer <token>`。

---

### D) Web/ Desktop 同步不一致，或操作被“回退”

**常见根因**

- 实际连的是不同 Worker（端口/Token 不一致）。
- 发生 revision conflict，旧版本合并策略会覆盖/回退未修改字段；或触发 resync。

**调试方法**

- 打开 Debug shell：`http://127.0.0.1:<port>/debug/shell`
- 在浏览器 Network 看 `/events` 是否持续收到 `app_state.updated`。
- 在两个 client 同时在线时，检查是否都订阅了同一个 endpoint。

---

### E) Web 归档 Space 后留下空 Space（节点清空但 Space 还在）

**根因（已修复）**

发生 revision conflict 时，三方合并（snapshot-aware merge）此前不保留 Space 的删除语义，导致 Space 被“复活”但 `nodeIds` 为空（ghost space）。

**解决办法**

- 确保 worker + client 使用包含 “sticky deletion（node/space 删除不复活）” 的版本。

---

## 4. 调试手段清单

### Browser DevTools（优先）

- Console：`pageerror`、CORS、网络失败
- Network：过滤这些路径快速定位问题：
  - `web.html`
  - `/assets/`
  - `/events`
  - `/invoke`
  - `/auth/*`
- Application：检查是否建立了 cookie session（LAN password / claim ticket 路径）

### Worker 日志（第二优先）

Worker stderr 会打印：

- `web ui:` Web UI 基础 URL
- `debug shell:` Debug shell 路由
- `auth required ...` 当前可用的鉴权方式
- `listening on all interfaces` 表示 bind 到 `0.0.0.0`（可用 LAN IP 访问）

### 回归与自动化（最后兜底）

- Web Shell E2E：`pnpm test:e2e:web-shell`
- Web Canvas E2E：`pnpm test:e2e:web-canvas`

---

## 5. 安全提醒（默认保守）

- 默认 worker 应保持 loopback-by-default（仅 `127.0.0.1`）。
- 需要远端访问时优先使用 SSH tunnel（`ssh -L`），避免把 worker 端口暴露到公网。
- LAN Access 必须显式开启，并设置 Web UI 密码；不要在 URL 里携带 token 给局域网设备分享。
