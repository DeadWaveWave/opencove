# 案例库（Case Library）

本目录用于收纳 **可复用的调试/诊断案例**，目标是让后续开发者（包括 AI）能通过真实案例快速建立直觉、复用排查路径、避免重复踩坑。

与之对应：

- `docs/DEBUGGING.md`：只记录 **方法** 与 **适用场景**（playbook / checklist）
- `docs/cases/*`：记录 **具体案例**（symptom → repro → investigation → root cause → fix → tests → lessons）

## 如何阅读

建议按以下顺序：

1. 先读 `docs/DEBUGGING.md`，确定你遇到的症状属于哪个场景、应该跑哪些最小命令。
2. 再在本目录按关键词/标签找相似案例，复用“怎么复现、怎么看证据、怎么定位”的路径。

## 案例模板（建议）

每个案例建议包含以下小节（不需要写成流水账，优先可复用）：

- **Symptoms**：用户可见现象（最好包含“何时发生/何时不发生”）
- **Environment**：平台/版本/关键依赖（Electron/xterm/CLI 版本、开关等）
- **Repro**：最小可复现步骤（能自动化就给命令/用例）
- **Investigation**：关键证据与排查路径（日志/trace/采样方法）
- **Root Cause**：一句话根因（包含 owner/边界/协议/时序）
- **Fix**：修复策略与关键实现点（不要贴大段代码，指向文件/模块即可）
- **Verification**：覆盖到的测试层级（unit/contract/e2e）与运行方式
- **Lessons**：可复用的规则/不变量/踩坑清单

## 目录索引

- `docs/cases/WIN10_CODEX_SCROLL_DIAGNOSTICS.md`
- `docs/cases/CASE_STUDY_CANVAS_JITTER_AND_TERMINAL_DURABILITY.md`
- `docs/cases/opencode-embedded-theme-sync.md`
- `docs/cases/vitest-electron-mock-missing-exports.md`
- `docs/cases/xterm-hit-test-cursor-flicker.md`

