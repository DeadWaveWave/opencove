# CLI / Worker 安装与独立 Server 发布设计说明

日期：2026-04-29
状态：继续实现中；macOS/Linux 已本地验收，Windows release/installer 支持已补齐并进入验证（2026-04-30）
范围：修复 Desktop 内置 CLI 安装；新增无需 Desktop 的独立 CLI / Worker / Web UI 发布与安装链路；本次先定义架构、边界、生命周期与验收，不进入实现细节。

## 实现更新（2026-04-29）

已落地：

- Desktop `Install CLI` / `Uninstall CLI` 改为写 runtime-backed launcher，并能识别“已安装但需修复”的坏入口。
- packaged CLI 改为从发布 runtime 内部自洽启动，不再依赖 repo checkout 路径。
- release workflow 新增 standalone server bundle（最初 macOS / Linux）和 `opencove-install.sh` 资产。
- `opencove worker start` 新增 `--web-ui-password`，用于 server-only 的 Web UI 登录配置。

继续补齐（2026-04-30）：

- Desktop 内置 CLI 安装新增 Windows `opencove.cmd` launcher，并写入用户级 PATH。
- release workflow 新增 Windows standalone bundle（`opencove-server-windows-<arch>.zip`）和 `opencove-install.ps1`。
- standalone 安装脚本新增官方卸载路径（`--uninstall` / `opencove-uninstall.*`）。
- release workflow 在上传前运行 standalone installer smoke，覆盖 asset -> launcher -> `opencove worker start --help`。

本地验收已覆盖：

- targeted unit / contract tests
- `pnpm check`
- standalone bundle 本地构建
- `opencove-install.sh` 安装 smoke
- 无 Desktop 场景下通过安装后的 `opencove worker start --web-ui-password ...` 拉起 Worker 与 Web UI

## 1. 问题类别

这不是一个“PATH 里少了一个命令”的局部安装问题，而是一个跨 `build / package / release / runtime / auth / lifecycle` 的发布拓扑问题。

OpenCove 当前已经具备两类能力：

- Desktop 应用可以通过本机 control surface 驱动业务；
- Worker 可以 headless 运行，并托管 Web UI 与 control surface。

真正缺失的是一套稳定、正式、可发布的安装语义：

- Desktop 自带的 `Install CLI` 现在依赖源码路径，打包后不可靠；
- GitHub Release 只发布 GUI 安装包，没有正式的独立 CLI / Worker server 资产；
- 想在服务器上安装 CLI 并启动 worker + Web UI 的用户，没有一条受支持的分发链路；
- 纯 server 场景的 Web UI 密码配置仍偏向 Desktop 流程，不够顺手。

因此，本设计要解决的不是“再补一个脚本”，而是：

`如何把 OpenCove 的 CLI / Worker / Web UI 变成两条明确安装链路下的同一套运行时语义，并且在 build、install、upgrade、restart、uninstall 全生命周期里保持边界清晰。`

## 2. 现有架构事实

以下事实来自现有代码与文档，属于本次设计的硬约束：

- CLI 是 client，不是业务 owner。
  - 见：`docs/CLI.md`
- Worker 是 durable truth owner；Desktop / Web UI / CLI 都通过 control surface 访问它。
  - 见：`docs/CONTROL_SURFACE.md`
- Worker 已经支持 headless 启动、control surface、Web UI、Debug Shell、LAN password 登录。
  - 见：`src/app/worker/index.ts`
  - 见：`docs/CONTROL_SURFACE.md`
  - 见：`docs/WEB_UI_TROUBLESHOOTING.md`
- 当前 CLI / Worker 启动链明确依赖 Electron runtime 作为 Node runner。
  - `src/app/cli/opencove.mjs`
  - `src/app/main/worker/localWorkerManager.ts`
  - `docs/DEBUGGING.md`
- 这不是偶然：仓库依赖 `better-sqlite3`、`node-pty` 等原生模块，当前安装链使用 `electron-builder install-app-deps`，说明 ABI 与 runtime 绑定需要被认真对待。

这意味着：

- 第一轮不应把需求误判成“发布一个纯 Node npm 包”；
- 当前更合理的方向是：发布一个独立的 server runtime bundle，运行时仍复用 Electron-backed runtime。

## 3. 参考与可迁移原则

### 3.1 code-server 的成熟做法

参考：

- `code-server` 官方安装文档
  - https://coder.com/docs/code-server/install

可迁移原则：

- 桌面产品之外，server 场景需要独立分发资产，而不是要求用户先安装 GUI；
- 一键安装脚本应只负责“选平台、拉资产、写 launcher、给出后续命令”；
- 真正的运行时资产应由 release 产物定义，而不是由安装脚本临时拼装。

### 3.2 GitHub Release latest asset 链接

参考：

- GitHub 官方 release 链接文档
  - https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases

可迁移原则：

- 稳定一键安装命令应优先面向 `stable` 的 latest asset；
- nightly 可以保留为显式 tag / 显式 channel，而不是和 stable 共用一条“latest”语义。

### 3.3 Electron 打包资源定位

参考：

- Electron `process.resourcesPath`
  - https://www.electronjs.org/docs/latest/api/process

可迁移原则：

- 打包后的 CLI / Worker 运行资源必须从运行时资源目录解析；
- Desktop 安装器绝不能继续指向 repo `src/` 或 dev build 假路径。

## 4. 当前问题与根因

### 4.1 Desktop 内置安装为什么坏

当前 [src/app/main/cli/cliPathInstaller.ts](../../../../src/app/main/cli/cliPathInstaller.ts) 生成的 wrapper 指向：

- `process.execPath`
- `app.getAppPath()/src/app/cli/opencove.mjs`

第二段路径是开发态假设，不是发布态 contract。

因此只要进入打包运行时：

- wrapper 仍然可能存在；
- status 仍可能显示“已安装”；
- 但实际 launcher 指向的 CLI entry 不存在或不稳定。

### 4.2 为什么不能只在 release 里再加一个 shell 脚本

当前 `opencove worker start` 并不是纯 shell / 纯 Node 脚本，它依赖：

- Electron runtime 作为 Node runner；
- Electron ABI 下安装的 `better-sqlite3`、`node-pty`；
- `out/main/worker.js`、`out/main/index.js`、`out/renderer` 等构建产物；
- worker control surface / Web UI 静态资源。

所以，如果 release 只多一个 shell installer，而不发布正式 runtime bundle，本质上仍然没有解决服务器安装问题。

### 4.3 纯 server 场景当前还差什么

纯 server 用户的目标通常是：

1. 安装 `opencove`
2. 启动 `opencove worker start`
3. 暴露本机或 LAN 上的 Web UI
4. 用浏览器访问并登录

但当前 CLI 只接受 `--web-ui-password-hash`，这更像“程序化输入”，不够像用户安装体验。

如果不补 `--web-ui-password <plain>` 或等价入口，server 场景虽然理论上能跑，实际上依然不顺手。

## 5. 目标与非目标

### 5.1 目标

- 修复 Desktop 打包版的 `Install CLI` / `Uninstall CLI`。
- 提供无需 Desktop 的独立 server 安装链路。
- 在 GitHub Release 中发布正式的独立 server 资产。
- 提供稳定的一键安装命令。
- 支持 server 上通过 CLI 启动 worker 并托管 Web UI。
- 显式梳理 build、install、start、restart、upgrade、uninstall 的 owner 与不变量。

### 5.2 非目标

- 第一轮不把 CLI 拆成独立 npm registry 包。
- 第一轮不改变 control surface 业务语义。
- 第一轮不重写 worker 的 auth / session 架构，只补足纯 server 可用性和安装 ergonomics。

## 6. State Owner 表

### 6.1 运行时与发布状态

- `desktop bundled cli runtime`
  - owner：Desktop packaging
  - write entry：build + package
  - restart source of truth：已安装 app 的 runtime resources
- `standalone server runtime bundle`
  - owner：release pipeline
  - write entry：release asset generation
  - restart source of truth：用户安装目录内的 bundle 内容
- `PATH launcher (opencove)`
  - owner：installer
  - write entry：Desktop 安装动作 / standalone 安装脚本
  - restart source of truth：用户 bin 目录中的 launcher 文件
- `release assets`
  - owner：release workflow
  - write entry：GitHub Actions release job
  - restart source of truth：GitHub Release 资产列表

### 6.2 Worker 生命周期状态

- `worker-control-surface.json`
  - owner：running worker process
  - write entry：worker boot / dispose
  - restart source of truth：当前活着的 worker 进程 + connection file
- `control-surface.json`
  - owner：Desktop main process
  - write entry：Desktop control surface boot / dispose
  - restart source of truth：当前活着的 Desktop process + connection file
- `opencove.db`
  - owner：worker persistence layer
  - write entry：worker-owned use cases / persistence store
  - restart source of truth：SQLite durable state
- `web ui password hash`
  - owner：worker runtime config
  - write entry：Desktop settings flow 或 CLI startup/config path
  - restart source of truth：worker config / explicit CLI flags

## 7. 不变量（Invariants）

1. `opencove` 在任何发布形态下都不能依赖 repo `src/` 路径。
2. Desktop 自带安装与 standalone server 安装，最终都必须生成同语义的 `opencove` launcher。
3. 没有 Desktop 的机器上，独立安装后的 `opencove worker start` 必须可独立启动 worker。
4. Worker 仍然是 durable truth owner；CLI 不能因为变成独立分发就越权直读写 DB。
5. 如果启用 LAN Web UI，必须存在密码保护或等价安全门禁。
6. 同一 `userData` 下最多一个本地 worker；多实例选择规则仍按现有 CLI 规范执行。
7. release pipeline 里，GUI 安装包与 standalone server bundle 的版本号、channel 语义必须一致。

## 8. 生命周期与边界检查

### 8.1 Build 阶段

边界：

- source tree
- build output
- packaged resources
- release asset assembly

必须避免的问题：

- dev-only 路径泄漏到发布 contract；
- GUI bundle 和 standalone bundle 引用不同版本的 CLI runtime；
- Worker Web UI 静态资源只进入 GUI 包而没进入 standalone bundle；
- Electron ABI 依赖被误当成纯 Node 依赖处理。

### 8.2 Install 阶段

边界：

- Desktop app installer
- standalone install script
- user install directory
- user PATH directory

必须避免的问题：

- launcher 看起来写成功了，但实际 target 不存在；
- 重复安装生成多个 `opencove` 入口；
- 覆盖安装后旧 launcher 仍指向已删除版本目录；
- 安装脚本隐式修改 shell 配置，且未给出清晰提示。

### 8.3 First Launch / Worker Start

边界：

- launcher -> runtime entrypoint
- runtime entrypoint -> worker.js
- worker -> control surface
- worker -> Web UI

必须避免的问题：

- launcher 选错 runtime root；
- worker 缺资源但只在启动中途崩溃；
- Web UI 静态资源缺失导致 worker 活着但浏览器白屏；
- CLI 在 standalone 场景仍然要求 Desktop 依赖。

### 8.4 Auth / Web UI

边界：

- bearer token
- login password
- cookie session
- Desktop claim ticket

必须避免的问题：

- server-only 场景仍强依赖 Desktop claim ticket；
- LAN 场景未设置密码却暴露 Web UI；
- `--web-ui-password-hash` 成为唯一入口，造成用户难以正确配置；
- 文档没有明确区分 loopback / tunnel / LAN 的安全建议。

### 8.5 Restart / Upgrade / Move

边界：

- app/runtime 版本升级
- 安装目录变化
- launcher 指针
- persisted userData

必须避免的问题：

- Desktop 升级后 launcher 指向旧版本 resources；
- standalone bundle 升级后旧文件残留导致部分版本混用；
- worker restart 后 connection file 恢复语义变化；
- 更新只验证“新安装”，没验证“已有用户数据 + 已有 launcher”的 repair。

### 8.6 Uninstall

边界：

- launcher removal
- runtime directory removal
- userData retention

必须避免的问题：

- 卸载 launcher 时误删用户自定义命令；
- 卸载 standalone runtime 时误删 userData / DB；
- Desktop 卸载后 standalone launcher 也被误判成 Desktop-owned；
- status 检测依然报告 installed。

## 9. 推荐方案

### 9.1 两条安装链，一套运行时语义

保留两条用户入口：

- Desktop 自带安装
- standalone server 安装

但统一目标：

- 都提供同一命令：`opencove`
- 都支持同一 worker 启动语义
- 都连向同一套 control surface contract

### 9.2 发布形态

第一轮推荐发布两类产物：

- GUI 安装包
  - 继续面向 Desktop 用户
- standalone server bundle
  - 面向 server / headless / SSH / Web UI 用户

standalone bundle 的建议内容：

- Electron-backed runtime
- CLI entry
- worker entry
- Worker Web UI 静态资源
- 启动所需原生依赖

### 9.3 Desktop 安装修复

Desktop 内置 `Install CLI` 应：

- 改为指向 Desktop 自带的打包资源；
- 通过稳定 runtime root 解析 CLI entry；
- status 不能只看 wrapper 是否存在，还要校验它是否仍指向可解析的 OpenCove runtime。

### 9.4 Standalone 一键安装

Stable channel 提供：

```bash
curl -fsSL https://github.com/DeadWaveWave/opencove/releases/latest/download/opencove-install.sh | sh
```

脚本职责仅限于：

- 识别平台与架构
- 下载对应 standalone bundle
- 解压到用户目录
- 写 `opencove` launcher
- 输出下一步命令

脚本不负责：

- 拼装运行时文件
- 动态 patch 业务代码
- 修改业务配置语义

### 9.5 纯 server Web UI 体验

推荐为 CLI 增加：

- `opencove worker start --web-ui-password <plain>`

并保留：

- `--web-ui-password-hash <hash>`

原则：

- 人类用户优先用明文密码入口；
- 自动化 / IaC 继续可用 hash 入口；
- LAN Web UI 仍然强制要求密码。

## 10. 风险与 trade-off

### 10.1 为什么不先做 npm 全局包

表面上看，`npm i -g opencove` 很诱人。  
但当前仓库的真实约束是：

- Electron ABI 原生依赖已经进入核心运行链；
- Worker 与 PTY / SQLite / Web UI 构建产物是同一套 runtime；
- 贸然拆成纯 Node 包会把当前问题升级成“第二套运行时体系”。

所以第一轮 trade-off 是：

- 接受 standalone bundle 体积更大；
- 换取更低的 ABI 风险和更一致的行为语义。

### 10.2 平台范围更新

初始实现先覆盖 Linux / macOS。后续根据用户明确需要，Windows server 安装链路已补齐为正式范围：

- Windows standalone asset 使用 `.zip`，避免要求用户安装 POSIX `tar` 工具。
- Windows launcher 使用 `opencove.cmd`，由 Desktop installer 或 PowerShell installer 写入用户级 bin 目录。
- Windows installer 默认把 `%LOCALAPPDATA%\OpenCove\bin` 加入用户级 PATH，新开的 PowerShell / cmd 可直接使用 `opencove`。
- Windows 卸载会移除 OpenCove-owned launcher、standalone bundle 和 installer 写入的用户级 PATH 项。

## 11. 验收标准

- Desktop 打包版中，设置页 `Install CLI` 成功后，`opencove` 命令可用。
- `Uninstall CLI` 后状态正确，launcher 被移除。
- 无 Desktop 的机器上，standalone 安装脚本可安装 `opencove`。
- standalone 安装后，`opencove worker start` 可启动 worker。
- worker 启动后，可访问 Web UI，并在 LAN 场景通过密码登录。
- Release 页面出现 standalone 资产与安装脚本。
- README / README_ZH / `docs/RELEASING.md` / `docs/CLI.md` 更新为正式支持的安装方式。

## 12. 验证分层

- Unit
  - runtime root 解析
  - launcher 内容生成
  - install status / repair 逻辑
  - Web UI password flag normalization
- Contract
  - worker start 参数校验
  - release asset naming / channel consistency
- Integration
  - standalone bundle -> launcher -> worker start
  - Desktop install -> launcher -> CLI call
  - restart / upgrade / reinstall repair
- E2E / smoke
  - 启动 worker，访问 Web UI，完成最小登录与页面加载验证

## 13. Feasibility Check 结论

结论已被实现阶段验证：第一轮采用 `Electron-backed standalone server bundle` 是可行路径，且当前范围应保持为 `macOS / Linux + shared runtime semantics + password-protected Web UI`。
