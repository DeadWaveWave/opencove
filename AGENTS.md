# System Prompt: OpenCove Project AI Developer Agent

This file defines the **Unified Execution Standard** for all Agents (including Codex/Claude Code) working on the OpenCove repository.

Your primary directive is to **Read `DEVELOPMENT.md` first** and strictly adhere to its rules. Follow the documented process before acting, and convert good engineering judgment into explicit steps, checks, and deliverables.

**Target**: Rapid iteration of core features while ensuring regression testing, traceability, and acceptance.

## 1. Core Directives & Golden Rules

0.  **Top-tier Architecture Mindset**: Never use a "patch" mindset. Before coding, simulate how top-tier teams, famous open-source projects, or industry leaders would solve this problem. For mature industry problems, you MUST research them per `REFERENCE_RESEARCH_METHOD.md`.
1.  **Golden Rule**: ALWAYS read `DEVELOPMENT.md` at the start of a task. It is the default source of truth for architecture, workflow, commands, and detailed execution method.
2.  **Monorepo**: Always set correct CWD. Follow the file structure defined in `DEVELOPMENT.md`.
3.  **Tooling Integrity**: NEVER edit `lock` files or scripted generated code manually. Use the commands defined in the relevant module `DEVELOPMENT.md` (linked from root `DEVELOPMENT.md`).
4.  **Keep AGENTS Concise**: `AGENTS.md` should state key directives, decision gates, and non-negotiables only. Detailed methods, examples, and step-by-step execution guidance belong in `DEVELOPMENT.md` or topic docs.

## 2. Decision Framework (Small vs Large)

On **every instruction**, triage the request and tell the user whether it is **Small** or **Large**.

### A. Small Change (Fast Feedback / 小步快反馈)
- **Scope**: Localized, low-risk, non-structural work.
- **Action**: Proceed directly, run targeted verification, and tell the user what risks you checked.
- If the change touches runtime risk, ownership ambiguity, or cross-boundary behavior, upgrade it to **Large**.

### B. Large Change (Deep Thinking / 慎重对齐)
- **Scope**: New features, refactors, schema/API changes, cross-module logic, or runtime-risk work.
- **Action**: Before coding, you MUST: `Spec -> Approval -> (Feasibility Check if needed) -> Plan -> Approval`.
    - `Spec` must EXPLICITLY cover:
        1. The best industry practice/reference (Simulate the top-tier mindset; explicitly research only if it's a mature industry problem per Rule 0).
        2. Business logic & acceptance criteria.
        3. State owners, invariants, and top risks.
        4. Planned verification.
    - `Feasibility Check` is required for new technology, high-performance work, system dependencies, or core refactors.
    - `Plan` must break execution into independently verifiable steps and identify the lowest meaningful regression layer for high-risk work.

## 3. Required Pre-Coding Checks

Before implementation, do the following when the change is non-trivial:

- Identify mutable state, owner, allowed transitions, and what is only derived UI.
- Write 1-3 invariants before relying on scenario lists.
- If ownership, authority, or semantics are ambiguous, stop and align before patching.
- If the problem likely has existing industry practice, study external references before specing.
- If fixing a real bug, leave behind a reusable asset such as a test, rule, assertion, or doc update.

## 4. Risk & Compliance Checklist

For runtime-risk or Large work, explicitly check:

- Async gaps, concurrency, and lifecycle cleanup.
- State ownership, durable truth, and restart/recovery semantics.
- Main/Preload/Renderer boundaries, IPC validation, and type safety.
- Performance, resource lifecycle, and data integrity.

## 5. Verification & Handoff

- Validate at the lowest meaningful layer first; use UI automation when UI regression risk warrants it.
- Small changes may use targeted verification; final Large changes must pass the full required checks from `DEVELOPMENT.md`.
- Keep detailed methods, examples, and execution playbooks in `DEVELOPMENT.md` and topic docs, not here.

## 6. Development Workflow

1.  **Plan**: Triage (Small/Large) -> Spec (if Large) -> Approval -> Feasibility Check (if needed) -> Plan -> Approval.
2.  **Code (TDD)**: `Red -> Green -> Refactor`.
3.  **Verify**:
    -   **Small**: Targeted unit/integration tests OK.
    -   **Final/Large**: **MUST** run full suite (`pnpm pre-commit`).
4.  **Commit**: Gates passing is not delivery. `git commit` immediately after the gates pass, then prove it with `git log --oneline <base>..HEAD` (your commit is listed) and `git status --short` (empty). Never report work as complete while it exists only in the staging area or the working tree.
5.  **Submit**: Review self -> Update PR description -> Handover.
