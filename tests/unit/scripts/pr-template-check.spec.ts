import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  validatePullRequestBody,
  validateTemplateStructure,
} from '../../../scripts/lib/pr-template-check.mjs'

const templatePath = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '.github/pull_request_template.md',
)

function buildSmallPrBody(summary = 'Fixes the CI gap for PR template validation.') {
  return `## 💡 Change Scope

- [x] **Small Change**: Fast feedback, localized UI/logic, low-risk.
- [ ] **Large Change**: New feature, cross-boundary logic, runtime-risk (persistence, IPC, lifecycle, recovery).

## 📝 What Does This PR Do?

${summary}

---

## 🏗️ Large Change Spec (Required if "Large Change" is checked)

**1. Context & Business Logic**

**2. State Ownership & Invariants**

**3. Verification Plan & Regression Layer**

---

## ✅ Delivery & Compliance Checklist

- [x] My code passes the ultimate gatekeeper: **\`pnpm pre-commit\` is completely green**.
`
}

function buildLargePrBody() {
  return `## 💡 Change Scope

- [ ] **Small Change**: Fast feedback, localized UI/logic, low-risk.
- [x] **Large Change**: New feature, cross-boundary logic, runtime-risk (persistence, IPC, lifecycle, recovery).

## 📝 What Does This PR Do?

Adds a guarded recovery path for agent session hydration.

---

## 🏗️ Large Change Spec (Required if "Large Change" is checked)

**1. Context & Business Logic**

Hydration should reuse the durable session snapshot instead of the transient renderer cache.

**2. State Ownership & Invariants**

Main owns the persisted recovery state.

- Recovery never rewrites durable truth from renderer-only observations.
- A resumed session must point to the same persisted session id after restart.

**3. Verification Plan & Regression Layer**

Unit coverage for normalization plus integration coverage for restart hydration.

---

## ✅ Delivery & Compliance Checklist

- [x] My code passes the ultimate gatekeeper: **\`pnpm pre-commit\` is completely green**.
`
}

describe('PR template validator', () => {
  it('keeps the validator contract aligned with the repository PR template', () => {
    const templateMarkdown = readFileSync(templatePath, 'utf8')

    expect(validateTemplateStructure(templateMarkdown)).toEqual([])
  })

  it('accepts a valid Small Change PR description', () => {
    expect(validatePullRequestBody(buildSmallPrBody())).toEqual([])
  })

  it('accepts a valid Large Change PR description', () => {
    expect(validatePullRequestBody(buildLargePrBody())).toEqual([])
  })

  it('rejects PR descriptions without a meaningful summary', () => {
    expect(validatePullRequestBody(buildSmallPrBody(''))).toContain(
      'What Does This PR Do? must contain a meaningful description.',
    )
  })

  it('rejects Change Scope when both Small and Large are selected', () => {
    const body = buildSmallPrBody().replace('- [ ] **Large Change**', '- [x] **Large Change**')

    expect(validatePullRequestBody(body)).toContain(
      'Change Scope must select exactly one of Small Change or Large Change.',
    )
  })

  it('requires all Large Change spec subsections when Large Change is selected', () => {
    const body = buildLargePrBody().replace(
      'Hydration should reuse the durable session snapshot instead of the transient renderer cache.',
      '',
    )

    expect(validatePullRequestBody(body)).toContain(
      'Large Change Spec requires content for **1. Context & Business Logic**.',
    )
  })
})
