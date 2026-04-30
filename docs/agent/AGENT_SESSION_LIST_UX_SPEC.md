# Agent Session List UX Spec

Status: Implemented and verified

Last Updated: 2026-04-30

## 1. Problem Class

This is a mature interaction problem: a session picker must help users recognize the right conversation quickly, without opening each session one by one.

OpenCove's current session list is functionally correct but semantically weak:

- many rows degrade to opaque `sessionId`
- users cannot tell task intent at a glance
- switching becomes trial-and-error instead of confident selection

The unstable promise today is: "session list lets me find the conversation I want." It currently only promises "session list shows resumable sessions."

## 2. External References

### Reference A: Claude Code session picker

Source:

- https://code.claude.com/docs/en/tutorials

Observed behavior:

- Claude Code documents that the picker shows:
  - session name if set
  - otherwise conversation summary or first user prompt
  - time since last activity
  - message count
  - git branch / project path in wider scopes
- it also supports preview before resume

Transferable principle:

- the primary list label must be semantic user intent, not an opaque technical id
- session metadata should help disambiguate, but not replace semantic labeling

What we will not copy directly:

- cross-project / cross-worktree widening shortcuts
- full preview mode in this phase
- message count unless we can source it cheaply and consistently

### Reference B: Cline history list

Source:

- https://raw.githubusercontent.com/cline/cline/main/src/shared/HistoryItem.ts
- https://raw.githubusercontent.com/cline/cline/main/webview-ui/src/components/history/HistoryViewItem.tsx

Observed behavior:

- `HistoryItem.task` is the semantic task text
- `HistoryViewItem` renders that task as the main visible label
- timestamp and secondary metadata stay subordinate

Transferable principle:

- for agent/task sessions, the initiating prompt is a valid default identity when no better title exists

What we will not copy directly:

- Cline's history card is larger and more detailed than OpenCove's current anchored menu

### Reference C: DeerFlow automatic title middleware

Source:

- https://raw.githubusercontent.com/bytedance/deer-flow/main/backend/packages/harness/deerflow/agents/middlewares/title_middleware.py

Observed behavior:

- DeerFlow auto-generates a thread title after the first complete user/assistant exchange
- when generation is unavailable, it falls back to a truncated first user message

Transferable principle:

- prefer stable semantic titles when available
- fallback to first user message is acceptable and useful
- fallback must be local, deterministic, and non-blocking

What we will not copy directly:

- no LLM title generation in this phase
- no asynchronous title backfill that mutates durable session metadata

## 3. Local Constraints

### Current provider/session data availability

Validated locally in this environment:

- `claude-code`
  - already exposes `firstPrompt` via Claude index when available
  - raw transcripts also contain first user message
- `codex`
  - session log contains user `message` content, often wrapped inside `response_item.payload`
  - the earliest user entry can be harness/bootstrap text (`AGENTS.md` / environment context), so preview extraction must skip that bootstrap and continue to the first real task prompt
  - preview extraction is feasible by bounded top-of-file scan
- `opencode`
  - session list already provides `title` through CLI or DB
  - title should remain preferred semantic label
- `gemini`
  - current local installation did not expose a verified chat text source in the same way
  - preview extraction must therefore stay optional / best-effort

### UI constraints

- current interaction is an anchored header menu, not a full-screen picker
- row density matters, but semantic recognition matters more than absolute compactness
- reload/switch semantics already work and must remain unchanged

## 4. UX Goals

1. Users can identify the likely session they want in one scan.
2. Semantic intent appears before technical identifiers.
3. The current session is obvious without reading the whole row.
4. Missing preview data for one provider must not degrade the entire list.
5. The menu should stay fast enough to open on demand from the node header.

## 5. Proposed UX

### 5.1 Row information hierarchy

Each session row should render three layers, in this priority order:

1. Primary label
   - prefer explicit/provider title
   - else first user message preview
   - else `sessionId`
2. Secondary line
   - if primary label is a title, show first user message preview when available
   - otherwise show `sessionId`
3. Meta line
   - relative or human-readable last active time
   - optional status badge for current session

### 5.2 Display title rules

Introduce a derived display model per row:

- `displayTitle`
- `displayPreview`
- `displayIdentity`

Resolution order:

1. `displayTitle`
   - explicit/provider title if non-empty
   - else extracted first user message preview
   - else `sessionId`
2. `displayPreview`
   - extracted first user message preview when it is different from `displayTitle`
   - else `null`
3. `displayIdentity`
   - compact technical identity, usually `sessionId`

This avoids duplicate rows such as:

- title line: `Fix login callback`
- subtitle line: `Fix login callback`

### 5.3 Visual layout adjustments

- widen the session menu from compact technical list to a readable semantic list
- allow title line to wrap or clamp to `2` lines
- allow preview line to clamp to `2` lines
- de-emphasize `sessionId` visually
- keep current-session checkmark, but also add a text badge such as `Current` if needed for clarity

### 5.4 Empty / degraded states

- if preview extraction fails, row still renders with title/sessionId
- no loading retry loop inside row rendering
- no placeholder text that looks like content

## 6. Data / Ownership Model

### Authoritative durable state

- provider session logs / indexes remain the source of truth
- OpenCove must not write back generated titles or previews in this phase

### Derived runtime state

- row title/preview are derived at list-fetch time
- renderer only displays derived summaries
- provider catalog layer owns extraction and normalization

### Proposed DTO evolution

`AgentSessionSummary` should evolve from raw list metadata to UX-ready summary metadata by adding:

- `preview: string | null`

`title` itself remains the raw/provider-provided semantic title when available, and the renderer derives display priority from `title -> preview -> sessionId`.

## 7. Invariants

1. Session switching authority does not depend on preview extraction success.
2. `sessionId` always remains available as a stable fallback identity.
3. Preview extraction must be bounded and best-effort, never an unbounded full-transcript parse.

## 8. Risks

### Risk A: performance regression when opening the menu

Cause:

- extracting first user prompt from multiple session files on every open

Mitigation:

- only inspect top-of-file bounded bytes / early messages
- keep result count capped
- only extract preview for visible list fetches

### Risk B: provider schema drift

Cause:

- local CLI session formats can change

Mitigation:

- provider-specific parsers with narrow fallback behavior
- if parse fails, fall back to existing title/sessionId without breaking list

### Risk C: duplicated or noisy labels

Cause:

- raw first prompt can be too long, too generic, or duplicate title

Mitigation:

- normalize whitespace
- trim length aggressively
- suppress subtitle when it equals title

## 9. Acceptance Criteria

1. In the session list, a `Codex` session with a first user prompt but no title renders that prompt as the main label instead of raw `sessionId`.
2. In the session list, a `Claude` session with `firstPrompt` renders that prompt/title semantically before `sessionId`.
3. In the session list, an `OpenCode` session continues to prefer its existing title.
4. When both title and first-user preview exist and differ, both are visible in one row without duplication.
5. When preview extraction fails, switching still works and the row falls back to `sessionId`.
6. Existing reload and switch flows remain behaviorally unchanged.

## 10. Planned Verification

Lowest meaningful layers:

- `Unit`
  - provider preview extraction
  - display title/preview normalization
  - duplicate suppression / fallback ordering
- `Contract`
  - DTO shape changes for optional preview fields
- `Renderer unit`
  - row hierarchy rendering for title-only / preview-only / fallback-id cases
- `E2E`
  - open session list and verify semantic row content for representative providers
  - switch session from a row identified by preview/title rather than id

## 11. Proposed Scope Decision

Phase 1 should focus on recognizability, not full session management:

- include semantic title/preview extraction and row redesign
- do not include rename, search, cross-project widening, or full preview pane
- do not include AI-generated persistent titles

If approved, the follow-up plan will implement this as a bounded provider-summary upgrade plus renderer row redesign.

## 12. Implementation Status

Implemented:

- `AgentSessionSummary.preview` contract upgrade
- bounded first-user preview extraction for `claude-code` and `codex`
- `opencode` title-first behavior preserved
- `gemini` stable `null` preview fallback
- renderer session row hierarchy redesign
- current-session badge and semantic confirmation dialog title

Verified:

- targeted contract and unit tests
- targeted workspace canvas unit tests
- Electron E2E for session list visibility and session switch
