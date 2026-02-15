# AGENTS.md

This file defines the **Unified Execution Standard** for all Agents (including Codex/Claude Code) working on the Cove repository.

Your primary directive is to **Read `DEVELOPMENT.md` first** and strictly adhere to its rules. Always think first in the aspect of genius who is the most skilled at the work that you are doing before you start to respond or work.

**Target**: Rapid iteration of core features while ensuring regression testing, traceability, and acceptance.

---

## 1. Core Directives & Golden Rules

1.  **Single Source of Truth**: This file (`AGENTS.md`) is the primary guide for agent behavior.
    -   **Project**: Cove (Local-first desktop workspace for AI coding agents).
    -   **Stack**: Electron, React 19, Tailwind v4, TypeScript.
    -   **Tooling**: `pnpm`, `playwright`.
2.  **Architecture Awareness**: Clean.
3.  **Tooling Integrity**: NEVER edit `lock` files or scripted generated code manually. Always use `pnpm` commands.

---

## 2. Decision Framework (Small vs Large)

On **every instruction**, triage the request and inform the user:

### A. Small Change (Fast Feedback)
-   **Scope**: Localized tweaks, simple bugfixes, no structural changes.
-   **Action**: **Proceed directly**.
    -   Run targeted tests for speed (e.g., `pnpm test <file>`).
    -   **Risk Guard**: If it touches `Critical Stability` areas (see below), treat as **Large**.
    -   **User Visibility**: State checked risks and verification steps.

### B. Large Change (Deep Thinking)
-   **Scope**: New features, refactors, schema/API changes, cross-module logic (IPC).
-   **Action**: **Stop & Align**. You MUST:
    1.  **Feasibility Check**: Verify CLI inputs, API endpoints, or file paths *before* proposing a plan.
    2.  **Draft a Spec(if not already)**: Define Business Logic + Critical Stability risks + Acceptance Criteria.
    3.  **Wait for Spec Approval**.
    4.  **Draft a Plan**: Break down into independently testable steps (TDD) + specific verification commands.
    5.  **Wait for Plan Approval**.

---

## 3. Risk & Compliance System (Electron/Cove Specific)

When planning a **Large Change**, evaluate these risks:

### I. Critical Stability Checklist
-   **Async Gap Safety**: Ensure `await` calls handle component unmounting or app closure gracefully.
-   **Concurrency & Race**: Debounce rapid user inputs; manage state machine boundaries.
-   **IPC Security**: Validate ALL inputs from Renderer in Main process. No blind trust.
-   **Resource Lifecycle**: Clean up event listeners (`removeListener`), disposables, and child processes.
-   **Performance**: Avoid blocking the Main process (UI freeze); optimize React re-renders.
-   **Data Integrity**: Database schema changes (Drizzle) must have corresponding migrations.

### II. Triggered Compliance Gates
-   **Architecture**: No logic leakage between Main and Renderer. Use `preload` for exposure.
-   **Type Safety**: No `any` types. Ensure IPC message payloads are strictly typed.
-   **Security**: maintained Context Isolation; enable Sandbox where possible.

---

## 4. Standard Execution Flow (Strict Order)

Follow this cycle for every task to ensure quality and traceability:

### Step 1. Plan & Feasibility
-   Read requirements thoroughly.
-   **Verify Feasibility**: Check if the requested libraries, APIs, or CLI commands actually exist and work *before* implementation.
-   Define the **Minimum Deliverable** (MVC).

### Step 2. Code (TDD)
-   **Write Failing Test** (Red) first (Unit or E2E).
-   **Write Min Code** (Green) to pass the test.
-   **Refactor** for clarity and performance.
-   *Note*: Ensure changes are atomic and revertible.

### Step 3. Layered Verification
-   **Mandatory Checks** (Run these for every significant change!):
    1.  `pnpm lint:fix` (oxlint auto-fix)
    2.  `pnpm format:check` (prettier)
    3.  `pnpm check` (typescript type check - CRITICAL)
    4.  `pnpm test -- --run` (vitest unit tests)
    5.  `pnpm test:e2e` (playwright - for UI/IPC flows)
-   **Failure Handling**: Fix root cause, do not suppress errors. Run full suite if unsure.

### Step 4. UI Automation & Manual Verification
-   For UI changes, use **Playwright** (`pnpm test:e2e`).
-   If automated test is too complex for a quick fix, provide **Screenshots** or **Screen Recordings** (save to `docs/output/`).
-   **Visual Debugging**: Verify actual UI presentation vs Design requirements.

### Step 5. Commit & Submit
-   **Commit Convention**: Use semantic commits (`feat:`, `fix:`, `test:`, `docs:`).
-   **Handoff**: Provide a summary of:
    -   Changes made (files).
    -   Verification results (test output, screenshots).
    -   Known risks or next steps.

---

## 5. Hard Constants & Constraints
1.  **Prohibited**: Direct editing of `pnpm-lock.yaml`.
2.  **Prohibited**: `any` types in new code (use `unknown` or specific types).
3.  **Requirement**: All async operations must handle errors explicitly.
4.  **Requirement**: E2E tests must be stable (use `data-testid`).
5.  **Requirement**: Documentation (`README.md`, `docs/`) must be updated if features change.

---

## 6. Agent System Prompt (Self-Correction)
You are the **Cove AI Developer**.
1.  **Analyze**: Is this Small or Large?
2.  **Check**: Feasibility first (Rule of 3 steps).
3.  **Plan**: Atomic steps, TDD approach.
4.  **Execute**: Code -> Verify (Lint/Type/Test/E2E).
5.  **Report**: Evidence-based completion with strict adherence to project constraints.
