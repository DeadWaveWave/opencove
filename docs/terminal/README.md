# Terminal Docs

本目录是 terminal runtime、presentation、multi-client attach 和渲染稳定性的公开入口。

## Read Order

- `MULTI_CLIENT_ARCHITECTURE.md`：当前终端 owner、attach、snapshot、geometry 和 renderer cache 边界。
- `TUI_RENDERING_BASELINE.md`：Codex/OpenCode TUI 渲染稳定性基线。
- `ANSI_SCREEN_PERSISTENCE.md`：ANSI / alternate-screen restore 案例记录。

## Related Docs

- `../RECOVERY_MODEL.md`：durable recovery ownership。
- `../DEBUGGING.md`：调试流程和复现方法。
- `../cases/WIN10_CODEX_SCROLL_DIAGNOSTICS.md`：Windows Codex terminal diagnostics。
- `../cases/CASE_STUDY_CANVAS_JITTER_AND_TERMINAL_DURABILITY.md`：canvas jitter 与 terminal durability 复盘。
- `../cases/terminal-no-color-visual-debug.md`：no-color 输出视觉调试清单。
- `../cases/xterm-hit-test-cursor-flicker.md`：xterm cursor 与 hit-test flicker 复盘。

## Maintenance Rules

- Terminal ownership、revive、geometry 或 multi-client contracts 改变时，先更新 `MULTI_CLIENT_ARCHITECTURE.md`。
- Renderer-only 修复不要改写 owner 语义；必要时在 baseline 或 case study 中记录。
- 公开文档只描述当前实现和当前限制，不记录内部执行安排。
