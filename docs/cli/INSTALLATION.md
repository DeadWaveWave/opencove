# CLI 安装与运行

## 1.1 安装拓扑

`runtime inspect` 只读取构建描述，`runtime verify` 在独立进程内验证执行环境；它们不会启动
Worker 或创建用户 profile。`runtime prepare` 把经过校验的托管部署请求交给独立 runtime
controller。controller 拥有安装/激活元数据，通过 Worker 的维护协议管理生命周期，并由
persistence 基础设施生成一致快照；普通业务 CLI 仍只能通过 Control Surface 访问业务状态。
详细所有权和恢复规则见 [Managed SSH runtime](../runtime/MANAGED_SSH_RUNTIME.md)。

OpenCove 目前支持两条正式的 CLI 安装链路：

- **Desktop 内置安装**：用户在 Desktop 的 **Settings → Worker → CLI** 中点击 **Install CLI**，由已安装的 app 写入 `opencove` launcher（Windows 为 `opencove.cmd`）。
- **Standalone server 安装**：用户从包含 standalone installer 与 runtime bundle 的 GitHub Release 下载资产，并通过 release 专属 `opencove-install-v<tag>.sh` / `opencove-install-v<tag>.ps1` 写入同语义的 `opencove` launcher。stable release 额外提供 `opencove-install.sh` / `opencove-install.ps1` 作为 latest stable 别名。

当前约束：

- Desktop 安装与 standalone 安装最终都生成 runtime-backed launcher。
- Desktop launcher 使用已安装的 Electron runtime；standalone launcher 只使用 bundle 内的纯
  Node runtime，不得加载或回退到 Electron。
- standalone bundle 内的 `better-sqlite3` 与 `node-pty` 必须按所附 Node runtime 的 module
  ABI 单独构建，并在归档前由该 Node runtime 真实加载验证。
- 打包态 launcher 必须指向发布 runtime 内的 CLI entrypoint，不能依赖 repo checkout 路径。
- launcher 会记录安装 owner；两条安装链可以互相覆盖安装，但卸载时只移除自己拥有的 launcher。
- Desktop 与 standalone 共用 `<launcher>.lock` 发布租约，mtime 超过 120 秒才可接管。
  接管者先独占创建 `<launcher>.lock.reclaim`，持有 claim 时重新核对原锁的身份与 mtime，
  再删除旧锁并独占创建新锁；不能把 claim 之前的检查当作删除授权。claim 也遵循相同
  的租约和接管协议，因此崩溃留下的 claim 可恢复。发布必须在租约内完成，释放时仅删除
  owner 记录仍匹配的锁。旧版安装器不遵循 claim 协议，不能保证与其并发接管时的互斥。
- standalone release 覆盖 macOS / Linux / Windows；Windows 资产格式为 `opencove-server-windows-<arch>.zip`。
- standalone launcher 必须从 bundle 内 `package.json` 读取版本并通过 `--app-version` 传给 Worker；缺失或非法版本必须拒绝启动，不能产生身份不明的 Remote Worker。
- 公开 installer 必须从同一 release 路径读取 `SHA256SUMS.txt` 并在解压前校验 bundle；缺失 checksum、缺少本机 SHA256 工具或 hash 不一致都必须 fail closed。
- stable release 同时发布 tag-pinned installer/uninstaller 和 `latest` 通用别名；nightly 只发布 tag-pinned 版本。Managed SSH 必须按 Desktop 当前版本使用 tag-pinned installer，不能把 `latest` 当作版本一致性保证。

若 latest stable 已包含 standalone installer assets，则可使用以下通用安装命令
（macOS / Linux）：

```bash
curl -fsSL https://github.com/DeadWaveWave/opencove/releases/latest/download/opencove-install.sh | sh
```

Windows PowerShell：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-RestMethod https://github.com/DeadWaveWave/opencove/releases/latest/download/opencove-install.ps1 | Invoke-Expression"
```

如果 `releases/latest/download/opencove-install.sh` 返回 `404`，说明 latest stable
尚未发布 standalone installer；此时应改用 Desktop 安装，或等待包含这些资产的
release。

安装 nightly 或任意指定 tag 的 release 时，应改用该 release 页面中的带版本脚本：

```bash
curl -fsSL https://github.com/DeadWaveWave/opencove/releases/download/v<version>/opencove-install-v<version>.sh | sh
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-RestMethod https://github.com/DeadWaveWave/opencove/releases/download/v<version>/opencove-install-v<version>.ps1 | Invoke-Expression"
```

当 latest stable 已包含 uninstall assets 时，可使用以下命令卸载 standalone
runtime：

```bash
curl -fsSL https://github.com/DeadWaveWave/opencove/releases/latest/download/opencove-uninstall.sh | sh
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-RestMethod https://github.com/DeadWaveWave/opencove/releases/latest/download/opencove-uninstall.ps1 | Invoke-Expression"
```

指定 nightly 或任意指定 tag 时，应使用对应的版本化 uninstall 脚本：

```bash
curl -fsSL https://github.com/DeadWaveWave/opencove/releases/download/v<version>/opencove-uninstall-v<version>.sh | sh
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-RestMethod https://github.com/DeadWaveWave/opencove/releases/download/v<version>/opencove-uninstall-v<version>.ps1 | Invoke-Expression"
```

无 Desktop 的 server 场景可直接启动 worker + Web UI：

```bash
opencove worker start --hostname 0.0.0.0 --web-ui-password 'change-me'
```

当 Web UI 暴露到 localhost 之外时，必须设置密码或等价安全门禁。

相关文档：[Agent playbook](AGENT_PLAYBOOK.md)、[Canvas node control](CANVAS_NODE_CONTROL.md)、[Managed SSH runtime](../runtime/MANAGED_SSH_RUNTIME.md)。


返回 [CLI 指南](README.md)。
