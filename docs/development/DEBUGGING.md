# Debugging Guide

## 规则

- 凡遇到 `pnpm pre-commit`、`pnpm test -- --run`、`pnpm test:e2e` 或单独 `Playwright` 用例失败，**继续排查前先读本文件**。
- 先缩小复现范围，再改代码；不要一上来跑全量。
- 若 UI 表现与代码不一致，先怀疑是否跑到了旧构建产物。
- Web UI（Worker Web Canvas / Debug Shell）常见问题速查见：`docs/runtime/WEB_UI_TROUBLESHOOTING.md`。
- Issue Report 诊断包的 owner、脱敏、预算和扩展规则见：`docs/development/ISSUE_REPORT_DIAGNOSTICS.md`。

## 失败后的首轮动作

1. 记录**原始失败命令**与**首个失败用例/报错**。
2. 判断失败类型：`format/lint`、`typecheck`、`unit`、`E2E`、运行时崩溃。
3. 若是单独跑 `Playwright`，先执行 `pnpm build`。
4. 只重跑目标失败项，确认是否稳定复现。
5. 若是 E2E，优先看 `screenshot`、`trace`、`console` 与持久化状态。

### Electron renderer / GPU 进程崩溃

`Page crashed` / `Target crashed` 是进程退出信号，不能按普通导航失败重试。
先看 CI 的 `[opencove-runtime-diagnostics]` 输出和失败附件
`electron-process-diagnostics`：它们保留 `render-process-gone` / `child-process-gone`
的 reason、exitCode、窗口加载阶段、GPU feature status 和退出时内存快照。
快照中的进程可能已不包含死掉的 renderer，不能把它当作崩溃前峰值内存。
主进程日志先于自动 reload 记录；测试必须在删除 userData 前保留日志及 stdout/stderr。
Playwright trace 中最先失败的步骤才是崩溃位置，后续 evaluate 的错误可能只是结果。
本地验证链路：构建后运行 `runtime-diagnostics.renderer-crash.spec.ts`，该测试明确调用
`webContents.forcefullyCrashRenderer()`，并验证应用清理后附件仍存在。

恢复测试的主进程身份必须通过 `electronApp.evaluate(() => process.pid)` 从 Electron
内部读取。Playwright 1.58 在 Windows 使用 `shell: true` 启动，`electronApp.process()`
返回的是 shell launcher，PID 与 Electron 主进程不同。保留 launcher 的退出状态作为
进程清理证据，但比较恢复前后是否为同一个主进程时必须使用 Electron 自己的 PID。

#### E2E 原生 minidump 与符号化

只有 **Windows** 上 `NODE_ENV=test` **且**设置了 `OPENCOVE_TEST_USER_DATA_DIR` 的
Desktop 启动才会启动 Electron Crashpad。主进程在创建 renderer 前把 `crashDumps` 指向该测试 profile
内的 `crashDumps/`，使用 `uploadToServer: false`、`ignoreSystemCrashHandler: true`。
生产启动不改变 crash reporter 或系统 crash handler。dump 含进程内存，不属于脱敏诊断包，
不要提交到 Git、发送到在线符号化服务，或改成真实用户 profile。

Windows 是当前存在未解释原生 renderer 崩溃的平台。macOS 的真实 fixture 交错 A/B
测量发现启用 reporter 后，启动到空 workspace 就绪加关闭的配对中位增量超过 20 ms，
所以不让 macOS/Linux 每次 E2E 启动承担 handler 成本。恢复测试按平台断言：Windows
必须有一个有效 dump，其他平台必须没有 dump；不能用“有没有捕获到 dump”决定是否检查。

E2E fixture 在启动前记录已有 dump，退出后、删除 profile 前把本次新增的 `.dmp`
复制到 test output，并作为 `electron-minidump-*.dmp` 附件保留。扫描不依赖 Crashpad 的
平台目录名（Windows 常见 `reports/`，macOS/Linux 常见 `pending/`、`completed/`），
也不跟随 symlink。fixture 通常在 test 的 `finally` 内关闭应用，此时 Playwright 尚未把
test 标成失败，所以所有新增 dump 都保留，包括明确注入的恢复测试。

Windows CI 的 `Upload Playwright report` 在 `failure()` 时上传整个 `test-results/`，
artifact 名为 `playwright-report-windows-platform-e2e`，保留 7 天；上述附件和原始副本均
在这个目录内，不需要单独上传测试 profile。已有 dump 不会在复用 profile 的下一次启动
重复附加。文字附件失败时仍尝试保存 dump；诊断错误不替换原始 test 错误。

在 Apple Silicon Mac 上分析 **Windows x64 / Electron 41.5.1** dump：

```bash
mkdir -p artifacts/crash-analysis/tools artifacts/crash-analysis/windows
curl -fL -o artifacts/crash-analysis/stackwalk.tar.xz \
  https://github.com/rust-minidump/rust-minidump/releases/download/v0.27.0/minidump-stackwalk-aarch64-apple-darwin.tar.xz
tar -xf artifacts/crash-analysis/stackwalk.tar.xz -C artifacts/crash-analysis/tools
curl -fL -o artifacts/crash-analysis/windows-symbols.zip \
  https://github.com/electron/electron/releases/download/v41.5.1/electron-v41.5.1-win32-x64-symbols.zip
unzip -q artifacts/crash-analysis/windows-symbols.zip -d artifacts/crash-analysis/windows

# 从失败 run 下载；RUN_ID 替换为具体 run 编号。
gh run download RUN_ID --repo DeadWaveWave/opencove \
  -n playwright-report-windows-platform-e2e -D artifacts/crash-analysis/ci
# 将 dump_file 改为下载的 electron-minidump-*.dmp 路径。
dump_file=artifacts/crash-analysis/ci/path/to/electron-minidump.dmp
artifacts/crash-analysis/tools/minidump-stackwalk-aarch64-apple-darwin/minidump-stackwalk \
  --human "$dump_file" artifacts/crash-analysis/windows/breakpad_symbols \
  > artifacts/crash-analysis/renderer-stack.txt
```

Intel Mac 下载 `minidump-stackwalk-x86_64-apple-darwin.tar.xz`。stackwalker 的架构匹配
分析机；**symbols 的版本、平台和架构匹配崩溃进程**。保持 zip 内的 Breakpad 目录结构，
不要把 `.sym` 文件平铺。41.5.1 Windows x64 的主模块为
`electron.exe.pdb/87F7B822BA38AB224C4C44205044422E1/electron.exe.sym`。
工具按模块 debug ID 匹配；仅有 `electron.exe + offset` 而没有函数名时，先查版本、
架构、debug ID 和传入的 `breakpad_symbols` 根目录。系统 DLL 没有符号时仍可分析
Electron 帧；不要把未知系统帧误报为 Electron 的根因。

本机端到端验证：先 `pnpm build`，再运行
`OPENCOVE_E2E_DISABLE_CRASH_FALLBACK=1 pnpm exec playwright test tests/e2e/runtime-diagnostics.renderer-crash.spec.ts`。
该测试在 Windows 检查 profile 删除后的 dump 与 `MDMP` 签名，其他平台仍检查恢复与文字附件。
CI 的 `platform-e2e-windows` 也运行它，所以 Windows 上的捕获链路每次 PR 都会被验证。
若需在 Mac 重新验证原生符号化链路，仅在本地临时移除 `startTestCrashReporter` 的平台判断，
保留 test/profile 条件并重新构建，用下面的临时测试产生 dump；完成后恢复平台判断并重新构建，
不要提交该临时改动。`forcefullyCrashRenderer()` 在 macOS
可能先请求诊断快照再杀进程，此时 stackwalker 显示 `No crash`，不代表 dump 不可用。
若要验证真正异常的 faulting frame，可在使用 `launchApp` 的临时 Playwright 测试中，
通过 CDP 调用 preload 隔离上下文的 `process.crash()`（不要向产品组件或 bridge 增加入口）：

```ts
const cdp = await electronApp.context().newCDPSession(window)
const contexts: Array<{ id: number; name: string }> = []
cdp.on('Runtime.executionContextCreated', ({ context }) => contexts.push(context))
await cdp.send('Runtime.enable')
const isolated = contexts.find(context => context.name === 'Electron Isolated Context')!
const crashed = window.waitForEvent('crash')
await cdp.send('Runtime.evaluate', {
  expression: 'process.crash()', contextId: isolated.id,
}).catch(error => {
  if (!/crash|closed/i.test(String(error))) throw error
})
await crashed
// finally 中必须 await electronApp.close()，以保留附件并清理本测试进程。
```

macOS arm64 dump 使用 `electron-v41.5.1-darwin-arm64-symbols.zip`，其余符号化步骤相同。
已用 Electron 41.5.1 在 macOS arm64 生成真实 renderer 异常、让临时测试失败，并在 profile
清理后符号化保留的 dump：`EXC_BAD_ACCESS / KERN_INVALID_ADDRESS`，地址 `0x0`，
`CrRendererMain` 顶帧 `electron::ElectronBindings::Crash()`，源码 `electron_bindings.cc:118`。
这证明捕获、失败附件和符号化链路；它不等于复现 Windows 的自发访问违规。

参考：[Electron crashReporter](https://www.electronjs.org/docs/latest/api/crash-reporter)、
[Electron Crash Reporting](https://www.electronjs.org/docs/latest/tutorial/crash-reporting)、
[rust-minidump](https://github.com/rust-minidump/rust-minidump)。

#### Crashpad handler 生命周期与 profile 清理

Electron 41.5.1 使用 Chromium 146.0.7680.216 中的 Crashpad。handler 的退出条件是
**所有 client 消失**，并非主进程退出瞬间：macOS 等待 exception port 失去全部 senders；
Linux 的 `--initial-client-fd` 等待全部 client socket 关闭；Windows 的
`--initial-client-data` 注册主进程，随后注册 renderer 等子进程，监视各 client 的进程句柄，
最后一个退出后结束服务。当前配置禁用上传；Electron 也没有启用 handler 的自我监控。
因此遗留的 Chromium client 可让 handler 活得比主进程更久，fixture 的 `close()` 不等同于
显式 join handler。源码与协议见
[Electron reporter 启动](https://github.com/electron/electron/blob/v41.5.1/shell/browser/api/electron_api_crash_reporter.cc)、
[Crashpad handler 文档](https://github.com/chromium/chromium/blob/146.0.7680.216/third_party/crashpad/crashpad/handler/crashpad_handler.md)。

Windows 的 metadata、settings 和 dump 文件操作没有 `FILE_SHARE_DELETE`，所以仍在
处理文件的 handler **可能阻止 profile 删除**；但数据库对象没有终身持有目录或 metadata
句柄，闲置 handler 存活本身不证明目录被锁。参考
[Windows database](https://github.com/chromium/chromium/blob/146.0.7680.216/third_party/crashpad/crashpad/client/crash_report_database_win.cc)、
[Windows file I/O](https://github.com/chromium/chromium/blob/146.0.7680.216/third_party/crashpad/crashpad/util/file/file_io_win.cc)。
`cleanupUserDataDirWithRetry` 已对 `EBUSY`/`EPERM`/`ENOTEMPTY` 做 6 次尝试（共等待 1.5 秒）；
耗尽后记录 `Skipping locked userData cleanup` 并留下目录，不让测试失败。没有新增或延长重试。
检查 Windows CI 时同时检查这条警告与对应 `--type=crashpad-handler` 的 database 路径；
不能因为 `close()` 已返回就声称 profile 一定删除。macOS unlink 语义也不能证明 Windows
没有句柄竞争，跨平台清理结果仍需各平台运行验证。

### Worker 在日志输出后失去响应

如果终端停止接受输入，并伴随 Worker 端口或 PID 被替换，检查启动器是否持续消费子进程
的 stdout/stderr。`readline.close()` 会暂停输入；就绪握手完成后必须继续排空管道，不能
把暂停读取误当成停止解析握手。Windows 上写满未消费的管道会阻塞 Worker，连健康检查
也无法响应。用超过管道容量的真实子进程输出验证后续工作与 HTTP 响应，而不是关闭日志
或仅延长健康检查超时。回归入口：`tests/integration/worker/localWorkerManager.stdout.spec.ts`。

短时健康检查超时只说明请求未及时完成。对本 Desktop 已启动且版本兼容的 Worker，
进程存活状态由持有的 `ChildProcess` 决定；自动恢复不得仅因探测失败替换仍存活的进程。
应同时检查 PID/端口是否保持一致，以及同一终端会话在负载和刷新后是否仍能接受输入。

### 持久化提示 I/O 失败，但数据库仍可读写

该提示也可能来自 Desktop 到 Worker 的请求超时。先在数据库隔离副本上验证读写，并检查
Worker 的独立查询响应、CPU、内存和打开的文件数；不要仅凭通用提示判断数据库损坏。
大量重复打开同一个 Agent transcript 时，检查会话标题同步是否因画布重渲染而重新订阅，
以及缓存未命中的并发请求是否重复扫描。

标题是派生展示，不能占满与持久化共享的 Worker 资源。PTY 订阅以运行生命周期为边界，
回调变化不能触发 cached metadata 重放；同一路径和文件指纹共享在途扫描，只有最新指纹
拥有缓存发布权。目录扫描必须限制并发，失败、文件变化和清理后允许正确重读。
恢复时 Worker 状态事件可能早于节点绑定；节点更新后应从事件中心补读运行时状态，
不能依赖回调变化触发的重新订阅补齐，也不能为补齐状态重新启动标题扫描。
回归入口：`ptyTaskCompletion.lifecycle.spec.tsx`、`agentSessionCatalog.cache.concurrent.spec.ts`
和 `agentSessionCatalog.scanBudget.spec.ts`。

## 测试层级选择（策略）

### Agent 启动反复完成提醒或误显 Working

对齐 Worker `agent.list`、运行事件和 transcript 的真实写入时间；短时间内多次完成可能是
历史回放，而非新任务。恢复读取应折叠为一次 baseline，不能发布历史 turn 边界；文件重写、
分块和半条 JSON 也遵循此规则。通知消费 Worker 的完成 ID 并去重，不从持久化的 UI 状态推断。
Codex SessionStart 只绑定身份；Working 需要任务证据。可信会话 ID 不代表 resume 启动，
身份发现也不能重置新 invocation 的 watcher 游标。旧 Codex rollout 按 ID 定位，不按近期目录
或 mtime 判断是否存在。回归入口：`agentSessionStartupBaseline.spec.ts`、
`terminalAgentWatcherStartup.spec.ts` 和 `recovery.agent-startup-history.spec.ts`。

目标：用 **最低成本** 的测试层级先定位问题；确认根因后再补足能防回归的覆盖。

### Unit（最快）

适用场景：

- 纯函数/协议解析/颜色转换等“无 IO、无时序”的逻辑
- 需要快速验证边界条件（例如 escape sequence/解析分片）

运行：

```bash
pnpm test -- --run tests/unit/<target>.spec.ts
```

### Contract（边界正确性）

适用场景：

- IPC/DTO 校验、approved workspace guard、主进程 handler 的输入/输出契约
- 需要验证“错误 code/debugMessage/guard 行为”是否符合约定

运行：

```bash
pnpm test -- --run tests/contract/<target>.spec.ts
```

### E2E（用户可见/跨边界）

适用场景：

- 主题切换、拖拽/缩放、focus、持久化/恢复、外部 CLI（OpenCode/Codex）行为
- 任何“只有把 Main/Renderer/PTY/外部进程串起来才会出现”的问题

运行：

```bash
pnpm test:e2e tests/e2e/<target>.spec.ts --project electron --reporter=line
```

## E2E 稳定运行原则

### 优先使用仓库脚本

运行：

```bash
pnpm test:e2e
```

该命令会先执行 `pnpm build`，再通过 `scripts/test-e2e-with-window-fallback.mjs` 启动 Playwright。

### 默认窗口模式与自动降级

- 默认窗口模式：`OPENCOVE_E2E_WINDOW_MODE=offscreen`
- 这是后台运行模式，通常比 `hidden` 更稳定。
- 若日志命中 Electron/Chromium 崩溃特征（如 `SIGSEGV`、`Target page, context or browser has been closed`），脚本会按更稳模式自动重试失败用例。

常用控制项：

```bash
OPENCOVE_E2E_WINDOW_MODE=inactive|offscreen|hidden pnpm test:e2e
OPENCOVE_E2E_DISABLE_CRASH_FALLBACK=1 pnpm test:e2e
```

### 单独跑 Playwright 时必须先构建

```bash
pnpm build
pnpm exec playwright test tests/e2e/<target>.spec.ts
```

否则 Playwright 可能继续使用旧的 `out/` 产物，造成“代码已改、现象没变”的假失败。

## E2E 调试流程

### 1) 先跑目标用例

```bash
pnpm exec playwright test tests/e2e/<target>.spec.ts --project electron --reporter=line
```

### 2) 失败时看 trace

```bash
pnpm exec playwright show-trace test-results/<failed-case>/trace.zip
```

优先检查：

- `console` / `pageerror`
- Electron 窗口是否真的完成加载
- 关键节点数量、选中态、空间框选态是否符合预期
- 截图中的点击/拖拽命中点是否正确
- UI 与持久化状态是否一致

### 3) 修复后先回到相关回归与本地快速门禁

```bash
pnpm verify:quick
```

先确认原失败用例与相邻不变量通过，再完成快速门禁；不要每修复一个测试就重新跑整个应用。完整 PR CI 在合并前执行。只有需要本地跨模块完整证据时，才额外运行 `pnpm verify:full`。快速通过与完整通过分开汇报，不能把睡眠中断或重试通过当作干净的完整结果。

## 真实 Agent / 外部 CLI 复现

默认 `NODE_ENV=test` 下，OpenCove 会用测试 stub 避免真的启动外部 Agent CLI。调试 OpenCode 这类“真实 TUI 行为”（例如主题切换、alternate screen、颜色查询）时，需要禁用 stub：

```bash
OPENCOVE_TEST_USE_REAL_AGENTS=1 pnpm test:e2e tests/e2e/workspace-canvas.opencode-embedded-theme.spec.ts --project electron --reporter=line
```

补充：

- 该开关会让测试直接 spawn 本机安装的 CLI（如 `opencode`），可能触发真实网络请求/账号权限；仅建议用于本地调试。
- 产物在 `test-results/**`：优先看 `trace.zip`、失败截图与控制台日志。

### Restored Agent 真实复现脚本

恢复后首屏、首次输入、真实 Agent TUI 尺寸/渲染问题优先使用仓库脚本：

```bash
ELECTRON_RUN_AS_NODE=1 OPENCOVE_REPRO_PROVIDER=codex OPENCOVE_REPRO_ITERATIONS=3 OPENCOVE_REPRO_CLOSE_MODE=cold-restart ./node_modules/.bin/electron scripts/debug-repro-restored-agent-input.mjs
ELECTRON_RUN_AS_NODE=1 OPENCOVE_REPRO_PROVIDER=opencode OPENCOVE_REPRO_ITERATIONS=2 OPENCOVE_REPRO_CLOSE_MODE=cold-restart ./node_modules/.bin/electron scripts/debug-repro-restored-agent-input.mjs
```

用 Electron 作为 Node runner 可以避免本机 Node ABI 与 Electron 原生依赖（例如 `better-sqlite3`）不一致导致的假失败。

Terminal recovery 的真实 SQLite/Worker contracts 已收口为跨平台脚本：

```bash
pnpm test:terminal-recovery:native
```

默认 Node Vitest 会跳过这组 Electron-native tests；不要把 skip 当成验证通过，提交/CI 仍需运行上面的专用门禁。

## Playwright 交互排查重点

### 1) 复杂拖拽优先使用真实鼠标事件

在 Electron `offscreen` + React Flow 场景中，`locator.dragTo()` 可能出现“看起来拖了，但状态没变化”的假成功。

结论：

- 节点拖拽、space 拖拽、多选框拖拽，优先使用 `page.mouse.move/down/up`
- 仓库内已有稳定 helper 时，优先复用 helper，而不是重新写 `dragTo()`

### 2) 多选后再拖，先给选择框一个极短 settle 时间

`nodesselection-rect` 刚出现时立刻拖动，可能命中还没稳定，导致多选拖拽偶发失败。

建议：

- 先确认 `.react-flow__nodesselection-rect` 可见
- 视情况等待一个很短的稳定时间，再开始拖拽

### 3) 避免被 minimap 或 overlay 误拦截

如果点击/拖拽看似命中目标但事件没生效，优先检查：

- minimap 是否覆盖了目标区域
- space overlay / drag handle / label 区域是否抢占事件
- 点击点是否过于贴边

### 4) React Flow：元素“可见但不在 viewport”

现象：

- Playwright 日志提示 `element is outside of the viewport`
- 但 `await expect(locator).toBeVisible()` 仍然通过

原因：

- React Flow 画布使用 `transform`（viewport 缩放/平移）。元素在 DOM 上“可见”，但实际绘制区域可能在屏幕外。
- `scrollIntoViewIfNeeded()` 对 transform 场景不一定有效。

处理：

- 先把目标节点带回视口（最简单：点击 `Fit View` 控制按钮 `.react-flow__controls-fitview`），再执行 click/drag。
- 对“节点创建后立即点击 close/resize”等操作，建议先做一次 `Fit View` 或 focus 到该节点，避免视口偏移造成误判。

### 5) 缩放/transform 场景避免依赖 `locator.boundingBox()` 做像素命中与断言

在 React Flow 缩放（viewport transform）场景下，尤其是 CI 里的 `inactive/offscreen` 窗口模式，`locator.boundingBox()` 偶发返回不稳定坐标，导致鼠标按下点不到目标元素，进而出现“mouse 走完了但 resize/drag 根本没发生”的假操作。

建议：

- 计算鼠标命中点时，优先用 `locator.evaluate(el => el.getBoundingClientRect())` 获取可视坐标，再用其中心点进行 `mouse.move/down/up`。
- 对像素级对齐断言留出容差（例如降低 `toBeCloseTo` precision，或用自定义 tolerance），避免被平台舍入差/动画 settle 影响。
- 断言 resize/drag 结果时，优先读持久化状态确认是否真的提交，而不是只看 UI 像素位置。

示例（命中点计算）：

```ts
const rect = await locator.evaluate(el => el.getBoundingClientRect())
const x = rect.x + rect.width / 2
const y = rect.y + rect.height / 2
await page.mouse.move(x, y)
```

### 6) 截图像素相同，但 PNG 文件比较失败

macOS Electron 截图可能带有不同的 PNG 元数据（例如可选的 `iCCP` 色彩配置块），即使画面像素完全一致，`Buffer.equals()` 也会返回 `false`。

- 视觉回归应比较解码后的图片尺寸与像素，或使用 Playwright 的图像比较断言，不要比较 PNG 文件字节。
- 对同一运行环境中的原始像素比较，解码时禁用色彩配置转换，避免把截图元数据差异引入结果。
- Fit View 等视口变化后，DOM 可见不代表合成帧已经更新。应在操作前的就绪状态采集基准，并等待连续两次解码像素一致后再做视觉比较。
- 修正比较方式后，应重新注入原来的视觉缺陷，确认断言仍能检出真实的颜色变化。

原生 Canvas2D 的重复 `getImageData` 读回还可能使 Chromium 从 GPU 切换到 CPU
栅格化，产生实际像素微差；这与 PNG 元数据不同。静止画布测试应先预热读回路径，
通过同尺寸 `resize` 通知和渲染帧让静态画布重新绘制，再从连续一致的帧建立基准。
随后仍严格比较输出前后的像素，不能等待它们变回预期结果；不要为测试修改生产
context 的 `willReadFrequently`，以免影响动画性能。

### 7) 指定 `deviceScaleFactor` 时，Ubuntu CI 的窗口会被屏幕裁小

Ubuntu CI 在 `xvfb-run -s "-screen 0 1600x1200x24"` 下运行。`launchApp({ deviceScaleFactor: 2 })` 时，1440×900 的窗口需要 2880×1800 物理像素，Linux 会把它限制在屏幕内，实际视口只有 800×600 CSS px。macOS 上 `enableLargerThanScreen` 生效，本地不会复现。

- 不要写死 `page.mouse.move(1000, 180)` 这类坐标；从实测的 `getBoundingClientRect()` 推导命中点，并用 `document.elementFromPoint` 确认点上是预期元素。
- 本地复现：在用例开头调用 `(await electronApp.browserWindow(page)).evaluate(w => w.setContentSize(800, 600))`。

## 持久化与状态污染排查

### 1) 测试优先使用 seed 状态

交互回归应尽量通过测试 helper 直接 seed workspace 状态，而不是依赖多步 UI 创建流程。

这样更容易排除：

- 右键菜单被遮挡
- 初始节点布局随机变化
- 前序步骤失败掩盖真实问题

### 2) 检查状态是否被前一个用例污染

重点确认：

- `opencove:m0:workspace-state`（旧版本可能是 `cove:m0:workspace-state`）是否已清理或重建
- `reload` 后是否真的读到了当前种入的数据
- workspace / nodes / spaces 数量是否与预期一致

### 3) 当 UI 与断言不一致时，直接读持久化状态

如果画面像是成功了，但断言仍失败，或反过来，优先直接读取持久化状态确认真实结果。

这通常能快速区分：

- 是事件根本没触发
- 是 UI 更新了但没持久化
- 是持久化已更新但断言时机不对

## 高频症状速查

### 终端交互后空白 / 整块重渲染

优先检查：

- `WorkspaceCanvas` 的 `nodeTypes` 是否保持稳定引用
- `TerminalNode` 是否只在必要时重建 xterm 实例
- 拖拽/缩放是否仅更新位置与尺寸，而不是替换节点身份
- 当前 E2E 是否使用了最新 `out/` 产物

### 终端 / Agent 恢复后无法输入（确认输入是否被拦截）

开启输入链路追踪（会打印较多日志）：

```bash
OPENCOVE_TERMINAL_INPUT_DIAGNOSTICS=1 pnpm dev
```

在日志中你会看到两类关键输出：

- `[opencove-terminal-diagnostics]`（来自 renderer 的 xterm 侧）
  - `event=xterm-onData` 表示 xterm 确实捕获到了输入
  - `event=xterm-onData-dropped` 表示输入被丢弃（通常是 hydration 阶段的 `ESC...` 序列）
  - `event=pty-write` 表示 renderer 正在把输入写入指定 `sessionId`
- `[opencove-pty-write]`（来自 main 的 PTY runtime）
  - `event=write-to-inactive-session` 表示输入写到了一个 `unknown/terminated` 的 session 上
    - 这通常意味着恢复后节点仍在用旧 `sessionId`，但 PTY 进程已经不存在，表现就是“怎么点都打不进去”

排查 focus 问题时，重点看 `details` 里的：

- `xtermHelperTextareaFocused` 是否为 `true`
- `activeElement` / `activeElementInsideTerminal` 是否符合预期

### 重启恢复后的 Agent 无法输入：本次有效调试法

- 先区分 **完整重启恢复** 和 **运行时 workspace/project 切换**；两者不能互相代替复现。
- 对 `recovery / worker / persistence` 问题，先 `pnpm build`，不要拿旧 `out/` 产物做判断。
- 先查 **session ownership**，再查 focus。恢复后若仍写入旧 `sessionId`，界面看着聚焦也会打到死 PTY。
- 固定看三层证据：`xterm-onData`、`pty-write`、目标 `sessionId` 是否仍有效。
- placeholder -> restored session 的焦点交接要单独验证；“placeholder 能输入”不等于“恢复后的真实 session 能输入”。

完整案例见：

- `docs/cases/agent-input-after-restart-recovery.md`

### OpenCode 内嵌：主题切换不完整 / 不即时更新

适用场景：

- OpenCove UI theme 已切换（黑↔白），但只有 OpenCode TUI 没完全更新（残留深色块/不变/闪一下又回去）

排查顺序：

1. **先确保复现链路可重复**：优先用可复现资产跑真实 OpenCode（见下方“真实 Agent / 外部 CLI 复现”）。
2. **确认主题真相来源**：OpenCode 侧 `theme: "system"` 通常依赖终端协议（OSC/CSI）而不是直接读 OS theme。
3. **确认 embedded state 是否隔离**：若出现“被锁住”的主题行为，优先怀疑 durable state（例如 `theme_mode_lock`），并检查是否为 embedded 注入了独立的 `XDG_STATE_HOME`。

参考案例：

- `docs/cases/opencode-embedded-theme-sync.md`

### Terminal（xterm）：cursor 闪烁 / 命中穿透 / 残影观感

适用场景：

- 鼠标在终端输入区/正文上 `text/default` 闪烁切换
- 偶发点击/滚轮像是“穿透”到底层画布

方法要点：

- 固定点连续采样 `document.elementFromPoint(x, y)`（200~500 次）来确认是否 hit-test 偶发漏命中
- 在漏命中那一帧同步采集关键层的 `getBoundingClientRect()` 与 `pointer-events`，用证据证明“几何正确但命中错误”
- 优先用真实用户数据、最新构建、可见且已聚焦的窗口复现；`offscreen/inactive` 更适合回归，不一定适合抓命中异常
- 先区分 **DOM renderer 重绘问题** 和 **WebGL 下的 hit-test 漏命中**，两者修法不同
- 避免默认用 overlay 盖一层（容易引入 TUI 鼠标/选择/链接点击回归）

参考案例：

- `docs/cases/xterm-hit-test-cursor-flicker.md`

### 切换 workspace 或重启应用后终端历史丢失

优先检查：

- 主进程是否维护 PTY 输出快照
- 是否提供并使用 `pty:snapshot`
- 渲染层是否持久化 `scrollback`
- 挂载时是否合并 `persisted scrollback` 与 `pty snapshot`
- 输出回写是否做了节流，且回调引用是否稳定

### 终端滚轮既没缩放画布，也没滚动终端

优先检查：

- 是否错误使用了 `onWheelCapture + stopPropagation`
- 是否应改为冒泡阶段的 `onWheel`
- 是否阻断了 React Flow，同时保留了 xterm 默认滚动

### 终端“无颜色 / 全白”（必须做视觉调试）

- 这类问题必须做**视觉调试**；`pty:snapshot` 里有 ANSI，不等于屏幕上真的有颜色。
- 对真实 CLI 的颜色问题，不要只跑 `NODE_ENV=test` 的 E2E；test stub 不能代替真实 `codex/gemini/...` 的视觉结果。
- 先区分两类问题：**ANSI 没产生**，还是 **ANSI 有了但没渲染出来**。
- 先做最小视觉验证，再做数据验证定位：例如输出一段绿色文本，或直接启动真实 `codex` TUI 截图对照。
- 排查顺序优先看 spawn env、`TERM`、`NO_COLOR` / `FORCE_COLOR`、attach/hydration 时序，以及 xterm palette/theme / renderer 差异。

完整案例见：

- `docs/cases/terminal-no-color-visual-debug.md`

### 测试：Vitest 的 `electron` mock 导出缺失导致运行时报错

适用场景：

- 报错里出现 `No "app" export is defined on the "electron" mock`（或类似信息）
- 代码侧看起来用了 optional chaining，但仍在访问 `electron.app` 时爆炸

排查顺序：

1. 优先看 `debugMessage`（或直接临时把 envelope error 打出来）
2. 检查测试中 `vi.doMock('electron', ...)` 是否遗漏了 `app` 等导出
3. 若确实需要在代码侧读取 `electron.app.getPath`，建议用 `try/catch` 护住（mock 可能在访问缺失导出时 throw）

参考案例：

- `docs/cases/vitest-electron-mock-missing-exports.md`

## 案例库

当你需要“同类问题的完整复盘 + 证据链 + 落地修法”，从这里开始：

- `docs/cases/README.md`

## 一句话原则

- **先确认是不是旧构建，再怀疑代码。**
- **先看 trace 和持久化状态，再猜 UI。**
- **复杂拖拽先信真实鼠标事件，不要先信 `dragTo()`。**
