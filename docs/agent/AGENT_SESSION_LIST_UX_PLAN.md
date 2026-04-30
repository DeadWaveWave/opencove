# Agent Session List UX Plan

> Status: Implemented and verified
> Scope: redesign Agent session list for semantic recognition, not just technical switching
> Last updated: 2026-04-30

Canonical references:

- `docs/agent/AGENT_SESSION_LIST_UX_SPEC.md`
- `docs/CONTROL_SURFACE.md`
- `docs/REFERENCE_RESEARCH_METHOD.md`
- `src/contexts/agent/infrastructure/cli/AgentSessionCatalog.ts`
- `src/contexts/workspace/presentation/renderer/components/terminalNode/TerminalNodeAgentSessionActions.tsx`

## Goal

在不改变现有 `reload session` / `switch session` 语义的前提下，把 Agent session 列表从“可切换”提升为“可识别”：

- 用户优先看到会话是做什么的，而不是先看到 `sessionId`
- 标题、首条用户消息预览、时间和当前状态有清晰层级
- provider 能拿到语义摘要时要充分利用，拿不到时也要稳定降级

## Non-Goals

- 不做 session rename
- 不做 session delete / archive / export
- 不做跨项目或全局 session browser
- 不做 AI 生成标题并写回 provider 存储
- 不做 transcript 全量索引、全文搜索或 preview pane

## Key Invariants

1. session switch authority 不依赖 preview 提取成功
2. `sessionId` 始终保留为稳定 fallback identity
3. preview 提取必须是 bounded / best-effort，不能变成完整 transcript 扫描
4. renderer 不直接读取 provider session 存储，provider catalog 仍是摘要 owner

## Phase 1: Summary Contract Upgrade

Status: completed

### Objective

先升级 session summary contract，让 renderer 拿到“可用于 UX 的摘要信息”，而不是在 UI 层猜测如何组合 title/id。

### Deliver

- 扩展 `AgentSessionSummary`，新增可选语义摘要字段：
  - `preview`
- 调整 `agent:list-sessions` contract、preload typing、browser/control-surface path
- 保留现有 `title` 作为 raw/provider title，不混入 UI fallback 结果

### Acceptance

- renderer 能从统一 DTO 判断：
  - 有无 provider title
  - 有无首条用户消息预览
- worker/browser/main 路径都返回同样的 session summary shape

### Minimum Verification

- `tests/contract/ipc/agentIpc.validate.spec.ts`
- `tests/unit/contexts/agentSessionCatalog.spec.ts`
- `pnpm check`

## Phase 2: Provider Preview Extraction

Status: completed

### Objective

在 provider catalog 层补齐“首条用户消息预览”提取，严格限制读取范围与失败成本。

### Deliver

- `claude-code`
  - 优先复用 `firstPrompt` 作为 `preview`
  - 缺失时从 transcript 提取首条 user message
- `codex`
  - 从 rollout 文件顶部 bounded scan 提取首条 `user` `input_text`
- `opencode`
  - 保持现有 `title` 优先
  - `preview` 保持 `null`
- `gemini`
  - 显式保持 `preview: null`
- 统一 preview normalize：
  - trim
  - collapse whitespace
  - truncate to safe length

### Acceptance

- Claude/Codex 在无 title 时能返回语义 `preview`
- OpenCode 不因这次改动丢失现有 title 体验
- Gemini 在拿不到预览时稳定降级，不抛错不阻塞列表

### Minimum Verification

- provider catalog unit tests 覆盖：
  - Claude index path
  - Claude transcript fallback
  - Codex first-user extraction
  - OpenCode title precedence
  - Gemini null-preview fallback
- bounded-read tests，证明不会无限读取大文件
- `tests/unit/contexts/agentSessionCatalog.preview.spec.ts`

## Phase 3: Renderer Display Model And Menu Layout

Status: completed

### Objective

把原始 summary 转成稳定的 row display model，并重新设计列表信息层级。

### Deliver

- 新增 renderer-side display normalization helper，例如：
  - `title`
  - `subtitle`
  - `identity`
- 规则：
  - title 优先于 preview
  - preview 与 title 相同则抑制重复
  - 最后 fallback 到 `sessionId`
- 调整 session menu UI：
  - 更宽的菜单
  - 主标题 2 行 clamp
  - 次标题 2 行 clamp
  - 预览/identity 作为次级信息
  - 当前 session badge / current text
  - 保持时间信息可见
  - directory 仅在与当前目录不同的时候显示

### Acceptance

- 一眼可区分“这个 session 是做什么的”和“这个 session 的技术身份”
- 当前 session 不需要依赖阅读整行才能辨认
- 无 preview 的 row 仍然整洁，不出现占位噪音

### Minimum Verification

- renderer unit tests 覆盖：
  - title-only
  - preview-only
  - title + preview
  - duplicate suppression
  - fallback to session id
- `tests/unit/contexts/agentSessionDisplay.spec.ts`
- `tests/unit/contexts/terminalNodeHeader.agentSessionActions.spec.tsx`
- targeted E2E row hierarchy assertions

## Phase 4: Regression, Copy, And Interaction Polish

Status: completed

### Objective

补齐文案、交互边缘情况与回归验证，保证这次 UX 提升不破坏已有切换能力。

### Deliver

- 更新中英文 i18n
- 调整 loading / empty / error 文案，使其更符合“识别/切换 session”的语义
- 校验 current session 行在 disabled 状态下仍可读
- 文档同步：
  - spec 状态
  - plan 状态
  - docs index
  - switch confirm dialog 使用语义标题 + 独立 session id 展示

### Acceptance

- session list 行为仍保持：
  - 打开
  - 加载
  - 当前项识别
  - 选择并切换
- 只是 UX hierarchy 变化，不引入新的切换路径或 owner

### Minimum Verification

- header/component unit tests
- E2E:
  - 打开列表并看到语义标题/预览
  - 通过语义行选择 session 并成功切换
  - 当前 session 行清晰可辨且不可误切换

## Lowest Meaningful Regression Layers

- `Unit`
  - provider preview extraction
  - display normalization
  - duplicate suppression
- `Contract`
  - DTO / IPC shape evolution
- `Renderer unit`
  - row rendering hierarchy
- `E2E`
  - session list recognizability and switch path

## Execution Notes

- 先做 contract，再做 provider extraction，再做 renderer layout，避免 UI 先绑定临时字段
- preview extraction 应复用现有 provider catalog，不新建 renderer-side parsing path
- 如果某 provider 的 preview source 不稳定，优先返回 `null`，不要制造误导性摘要
- 当前 menu 形态先保留 anchored popover，不在本期升级为 modal/browser

## Implementation Snapshot

- DTO 最终只新增 `preview?: string | null`；没有把 `displayTitleSource` 写进共享 contract
- `claude-code` 使用 `firstPrompt` 优先，缺失时从 transcript 回退提取首条 user message
- `codex` 从 rollout JSONL 进行 bounded top-of-file scan，兼容 `response_item.payload.message` 包装，并跳过 `AGENTS.md` / environment bootstrap user prompt 后提取首条真实任务 `input_text`
- `opencode` 保持现有 `title` 语义，`preview` 保持 `null`
- `gemini` 明确保持 `preview: null`
- renderer 通过 `title -> preview -> sessionId` 规则推导显示层级，不让 provider DTO 承担 UI fallback 语义

## Verification Snapshot

Passed:

- `pnpm check`
- `pnpm test -- --run tests/unit/contexts/agentSessionCatalog.spec.ts tests/unit/contexts/agentSessionCatalog.preview.spec.ts tests/unit/contexts/agentSessionDisplay.spec.ts tests/unit/contexts/terminalNodeHeader.agentSessionActions.spec.tsx tests/contract/ipc/agentIpc.validate.spec.ts`
- `pnpm test -- --run tests/unit/contexts/workspaceCanvas.agentSessionActions.spec.tsx tests/unit/contexts/workspaceCanvas.agentSessionSwitch.spec.tsx`
- `pnpm build`
- `pnpm exec playwright test tests/e2e/workspace-canvas.agent-header-session-actions.spec.ts tests/e2e/workspace-canvas.agent-session-switch.spec.ts --project electron --reporter=line`

Repo gate note:

- `pnpm pre-commit`
  - `line-check:staged`, `secret-check:staged`, `naming-check:staged`, `lint:fix`, `format-check:staged`, `check`, `test:staged` passed
  - `test:e2e:pre-commit` hit unrelated full-suite `arrange` E2E flakes on two separate runs:
    - `tests/e2e/workspace-canvas.arrange.pane.spec.ts`
    - `tests/e2e/workspace-canvas.arrange.semantic.spec.ts`
  - both failed specs passed immediately when re-run in isolation:
    - `pnpm exec playwright test tests/e2e/workspace-canvas.arrange.pane.spec.ts --project electron --reporter=line`
    - `pnpm exec playwright test tests/e2e/workspace-canvas.arrange.semantic.spec.ts --project electron --reporter=line`

## Stop Conditions

出现以下情况时暂停实现，先回到结构分析或补充对齐：

- 为了显示 preview，renderer 必须直接读 provider transcript
- preview 提取需要扫描完整大型 session 文件才能工作
- `title` / `preview` / `displayTitle` 的 owner 开始混淆
- 当前 menu 尺寸无法承载必要语义层级，被迫升级成另一种导航模型
