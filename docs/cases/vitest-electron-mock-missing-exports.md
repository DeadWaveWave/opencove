# Case: Vitest mock 的 `electron` 缺少导出导致运行时报错（即使 optional chaining 也会炸）

## Symptoms

- contract/unit 测试在 `agent:launch` 等路径失败，表面错误是 `agent.launch_failed`
- 进一步看 `debugMessage` 会出现类似：

> No "app" export is defined on the "electron" mock. Did you forget to return it from "vi.mock"?

## Environment

- Vitest
- 使用 `vi.doMock('electron', () => ({ ipcMain }))` 之类的 partial mock
- 代码侧通过 `import * as electron from 'electron'` 读取 `electron.app.getPath(...)`

## Root Cause

Vitest 的 module mock 在访问未定义导出时可能 **直接抛错**（而不是返回 `undefined`），因此：

- `electron.app?.getPath` 里的 `electron.app` 这一步就可能 throw
- optional chaining 不能阻止“访问 getter 时抛错”的情况

## Fix

两条路线任选其一（推荐 1）：

1. **代码侧容错**：访问 `electron.app` 的地方用 `try/catch` 兜住，失败时走测试 fallback。
2. **测试侧补齐导出**：mock `electron` 时同时返回 `app`（至少包含 `getPath`）。

本仓库对应修复示例：`src/contexts/agent/presentation/main-ipc/register.ts` 的
`resolveOpenCodeEmbeddedXdgStateHome()` 对 `electron.app.getPath` 包了一层 `try/catch`。

## Lessons

- partial mock “看起来只 mock 了 `ipcMain`” 但实际可能会影响其它导出访问；遇到奇怪的 `debugMessage`，优先怀疑 mock。
- 只要有 `import * as electron`，就要把它当成“可能有 getter/代理行为”的对象来对待，必要时用 `try/catch` 护住边界。

