<!--
Thanks for contributing to OpenCove! 🌌

🚨 CRITICAL: Before submitting, ensure you have read `DEVELOPMENT.md` and `CONTRIBUTING.md`.
Please fill out the template completely to avoid delays in review.
-->

## 💡 Change Scope

- [ ] **Small Change**: Fast feedback, localized UI/logic, low-risk.
- [ ] **Large Change**: New feature, cross-boundary logic, runtime-risk (persistence, IPC, lifecycle, recovery).

## 📝 What Does This PR Do?

<!-- Describe the "why" and "what" of your changes. Link any related issues using "Fixes #". -->

---

## 🏗️ Large Change Spec (Required if "Large Change" is checked)

<!-- Based on our guidelines in DEVELOPMENT.md, you MUST provide the following for any structural or high-risk change: -->

**1. Context & Business Logic**
<!-- What is the core behavior being introduced or modified? -->

**2. State Ownership & Invariants**
<!-- 
- Who owns the newly introduced or modified state (e.g., Main, Renderer, SQLite)?
- What are the 1-3 invariants that this change must preserve? (e.g., "The terminal PTY is always guaranteed to be destroyed when the React node unmounts") 
-->

**3. Verification Plan & Regression Layer**
<!-- How is this change locked down? Which testing layer proves the bug can never return? (Unit, Contract, Integration, E2E) -->

---

## ✅ Delivery & Compliance Checklist

- [ ] My code passes the ultimate gatekeeper: **`pnpm pre-commit` is completely green**.
- [ ] I have included new tests to lock down the behavior (or explicitly stated why it's untestable).
- [ ] I have strictly adhered to the `DEVELOPMENT.md` architectural boundaries.
- [ ] I have attached a screenshot or screen recording (if this touches the UI).
- [ ] I have updated the documentation accordingly (if adding a feature or changing a contract).

## 📸 Screenshots / Visual Evidence

<!-- Upload screenshots or screen recordings directly in the GitHub PR UI. Do not commit review-only media into the repo unless it is a maintained visual-regression baseline. -->
