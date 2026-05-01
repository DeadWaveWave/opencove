# Releasing / Packaging

## 本地打包

- 生成安装包：`pnpm build:mac`
- 生成 Windows 安装包：`pnpm build:win`
- 生成 Linux 安装包：`pnpm build:linux`
- 生成“明确不签名”的安装包：`pnpm build:mac:unsigned`

产物默认在 `dist/`：
- `*.dmg`
- `*-mac.zip`
- `*.exe`
- `*.AppImage` / 其他 Linux 包格式（取决于 electron-builder 实际输出）
- `opencove-server-<platform>-<arch>.tar.gz`（macOS / Linux standalone CLI / Worker runtime）
- `opencove-server-windows-<arch>.zip`（Windows standalone CLI / Worker runtime）

额外的 Release asset：
- 所有包含 standalone installer 的 release 都会发布 tag-pinned 脚本：
  `opencove-install-v<tag>.sh`、`opencove-install-v<tag>.ps1`、
  `opencove-uninstall-v<tag>.sh`、`opencove-uninstall-v<tag>.ps1`
- 只有 stable release 额外发布 latest stable 别名：
  `opencove-install.sh`、`opencove-install.ps1`、
  `opencove-uninstall.sh`、`opencove-uninstall.ps1`

## 发布渠道

本项目当前只区分两个发行渠道：

- `stable`：给普通用户安装的正式版，使用纯版本 tag，如 `v0.2.0`
- `nightly`：给你自己和早期测试者抢先试用的预发布版，使用带 nightly 后缀的 tag，如 `v0.2.0-nightly.20260312.1`

建议的判断标准：

- 发布 `nightly`
  - `main` 上有值得提前验证的新功能、重构或高风险修复
  - 你想先给少量测试者试，不想立刻推荐给所有人
- 发布 `stable`
  - 这批改动已经过你自己的实际使用验证
  - `pnpm pre-commit` 全绿
  - 你能清楚说明这次更新为什么值得普通用户安装

## GitHub：打 Tag 自动打包（unsigned）

本仓库已配置 GitHub Actions：当你 push 形如 `v*` 的 tag 时，会自动构建 `macOS / Windows / Linux` 三端产物，并自动创建对应的 GitHub Release。无需手动打包或手动上传产物。上传内容包括：
- macOS 产物（如 `*.dmg`, `*.zip`）
- Windows 产物（如 `*.exe`）
- Linux 产物（如 `*.AppImage`）
- macOS / Linux standalone server bundle（`opencove-server-<platform>-<arch>.tar.gz`）
- Windows standalone server bundle（`opencove-server-windows-<arch>.zip`）
- tag-pinned 一键安装 / 卸载脚本（`opencove-install-v<tag>.*`、`opencove-uninstall-v<tag>.*`）
- stable release 额外包含 latest stable 别名（`opencove-install.*`、`opencove-uninstall.*`）
- 汇总校验文件 `SHA256SUMS.txt`

注意：macOS 的应用内自动更新依赖稳定的代码签名（Developer ID）。当前 unsigned/ad-hoc 构建在 macOS 上会禁用更新检查；请通过 GitHub Releases 手动下载新版本。

其中：

- `v0.2.0` 会创建正式 `stable` release
- `v0.2.0-nightly.20260312.1` 会创建 `nightly` prerelease

### Standalone CLI / Worker 资产

只有当 release 实际包含以下资产时，才能对外宣称“可直接通过 GitHub Release 安装
OpenCove CLI / Worker”：

- `opencove-server-<platform>-<arch>.tar.gz`
- `opencove-server-windows-<arch>.zip`
- `opencove-install-v<tag>.sh`
- `opencove-install-v<tag>.ps1`
- `opencove-uninstall-v<tag>.sh`
- `opencove-uninstall-v<tag>.ps1`

stable release 额外再提供以下 latest stable 别名：

- `opencove-install.sh`
- `opencove-install.ps1`
- `opencove-uninstall.sh`
- `opencove-uninstall.ps1`

对外文档必须与已发布资产保持一致。如果
`releases/latest/download/opencove-install.sh` 返回 `404`，说明 latest stable 尚未
发布 standalone installer，README / docs 不应写成“latest stable 可直接安装”。

当 latest stable 已包含这些资产时，没有 Desktop 的机器可使用以下安装脚本：

macOS / Linux：

```bash
curl -fsSL https://github.com/DeadWaveWave/opencove/releases/latest/download/opencove-install.sh | sh
```

Windows PowerShell：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-RestMethod https://github.com/DeadWaveWave/opencove/releases/latest/download/opencove-install.ps1 | Invoke-Expression"
```

对于 nightly 或任意指定 tag 的 release，请改用对应 release 页面里的 tag-pinned
installer：

```bash
curl -fsSL https://github.com/DeadWaveWave/opencove/releases/download/v<version>/opencove-install-v<version>.sh | sh
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-RestMethod https://github.com/DeadWaveWave/opencove/releases/download/v<version>/opencove-install-v<version>.ps1 | Invoke-Expression"
```

安装脚本会：

- 按平台/架构下载 `opencove-server-<platform>-<arch>.tar.gz` 或 `opencove-server-windows-<arch>.zip`
- macOS / Linux 默认安装到 `~/.local/share/opencove`（可由 `OPENCOVE_INSTALL_ROOT` 覆盖）
- Windows 默认安装到 `%LOCALAPPDATA%\OpenCove\standalone`（可由 `OPENCOVE_INSTALL_ROOT` 覆盖）
- macOS / Linux 在 `~/.local/bin/opencove` 写入 launcher（可由 `OPENCOVE_BIN_DIR` 覆盖）
- Windows 在 `%LOCALAPPDATA%\OpenCove\bin\opencove.cmd` 写入 launcher，并把该目录加入用户级 PATH（可由 `OPENCOVE_BIN_DIR` 覆盖）

服务器上的典型启动方式：

```bash
opencove worker start --hostname 0.0.0.0 --web-ui-password 'change-me'
```

卸载 standalone runtime：

```bash
curl -fsSL https://github.com/DeadWaveWave/opencove/releases/latest/download/opencove-uninstall.sh | sh
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-RestMethod https://github.com/DeadWaveWave/opencove/releases/latest/download/opencove-uninstall.ps1 | Invoke-Expression"
```

对于 nightly 或任意指定 tag 的 release，请使用对应的 tag-pinned uninstall 脚本：

```bash
curl -fsSL https://github.com/DeadWaveWave/opencove/releases/download/v<version>/opencove-uninstall-v<version>.sh | sh
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-RestMethod https://github.com/DeadWaveWave/opencove/releases/download/v<version>/opencove-uninstall-v<version>.ps1 | Invoke-Expression"
```

发布约束：

- stable 同时发布 `latest` 通用别名与 tag-pinned 脚本；nightly 只发布 tag-pinned 脚本。
- `releases/latest/download/...` 只能表示 latest stable，不得在 nightly 文档中当作“当前 nightly”使用。
- release workflow 会在上传前使用本地生成的 standalone asset 运行安装后 `opencove worker start --help` smoke。

### Stable 流程

流程建议：

1) 用脚本准备版本与 changelog 模板

```bash
pnpm release:patch
# 或
pnpm release:minor
# 或显式版本
pnpm release:version 0.2.0
```

2) 填好 `CHANGELOG.md` 新增版本段落
   - 若本次为 `major` 或 `minor` 版本（例如 `0.1.0 -> 0.2.0`、`0.x -> 1.0.0`），必须补一段 `### ✨ Highlights`
   - 若本次为 `patch` 版本（例如 `0.2.0 -> 0.2.1`），不强制要求 `Highlights`
3) 为该 stable 版本补一份结构化 `What's New` manifest：
   - 路径：`build/release-notes/stable/v<version>.json`
   - 要求：至少提供 `en`；若有对外中文体验，则同步补 `zh-CN`
   - 该文件是应用内 `What's New` 的版本真相源；`CHANGELOG.md` 负责历史文档，二者不再互相解析
4) 更新 README 顶部的 `Important Announcement / 重要公告`，用 1-3 句短文概括这次对外想传达的重点
5) 运行 `pnpm pre-commit`
6) 提交 release 准备改动到 `main`
7) 创建并 push tag

```bash
git tag v0.2.0
git push origin main --tags
```

如需先预览下一版而不落盘：

```bash
node scripts/prepare-release.mjs 0.2.0 --dry-run
```

### Nightly 流程

`nightly` 默认不改 `package.json` 版本号，也不要求更新 `CHANGELOG.md`。它的作用是把当前 `main` 的某个快照发给测试者。
只有 `stable` release 才需要在仓库里 bump `package.json.version`；`nightly` 只是开发快照，不是新的正式版本承诺。
但为了让应用内更新检测能正确比较版本，CI 在构建 nightly tag 时会临时把 `package.json.version` 改成对应的 nightly tag 版本；这个改动只发生在 CI 构建目录，不会回写仓库。
应用内 `What's New` 不再在运行时抓 GitHub compare；nightly 会在构建前自动生成一份版本级 manifest，并嵌入安装包。

推荐流程：

1) 确认当前 `main` 已经推到远端
2) 用当天日期 + 递增序号创建 nightly tag

```bash
git tag v0.2.0-nightly.20260312.1
git push origin v0.2.0-nightly.20260312.1
```

约定建议：

- 同一天第一次 nightly 用 `.1`
- 同一天第二次 nightly 用 `.2`
- 如果下一次 stable 准备发 `v0.2.1`，nightly 也可以提前切到 `v0.2.1-nightly.20260313.1`

补充说明：

- `stable` 路径可以先运行 `pnpm release:version 0.2.0`，自动更新 `package.json` 和 `CHANGELOG.md` 模板。
- `prepare-release` 会在 `major / minor` 版本自动插入 `✨ Highlights` 模板；`patch` 版本不会插入。
- `nightly` 路径不需要运行 release 准备脚本；只要 push 合规 tag，CI 就会自动打包并发布 GitHub prerelease。
- 如需手动覆写某个 nightly 的应用内 `What's New`，可新增 `build/release-notes/nightly/v<version>.json`；存在时会优先于自动生成结果。
- Auto Update 依赖 release assets 中的 channel metadata（如 `latest.yml` / `nightly.yml`），GitHub Actions 会随构建一起上传。
- 构建命令会自动生成 `release/release-manifest.json`，并将其嵌入安装包，同时作为 GitHub Release asset 上传。

## Nightly 定时发布（每天 04:00 北京时间）

仓库提供一个定时任务：每天北京时间 `04:00` 自动从 `main` 打包并发布最新 `nightly`（GitHub prerelease）。

- Workflow: `.github/workflows/nightly.yml`
- Tag 形如：`v<package.json.version>-nightly.<YYYYMMDD>.<N>`

## 未签名/未公证的安装说明（给用户）

当前 Release 构建未做 Apple Developer ID 签名/公证，macOS 可能会拦截首次打开。

可选处理方式：
- Finder：右键 App → 打开 → 再次确认
- 或终端（拷贝到 Applications 后）：`xattr -dr com.apple.quarantine /Applications/OpenCove.app`

## 本地构建 Standalone 资产

如需本地验证无需 Desktop 的 CLI/server 安装链，请使用：

```bash
pnpm build:standalone
```

这会：

- 先构建 app 与 release manifest
- 生成 unpacked Electron runtime
- 再封装出 `dist/opencove-server-<platform>-<arch>.tar.gz`

## 后续启用签名 + 公证（可选）

当你开通 Apple Developer Program 后，可以在 CI 中注入签名证书与 notarize 凭据，让 Release 自动完成签名与公证。
