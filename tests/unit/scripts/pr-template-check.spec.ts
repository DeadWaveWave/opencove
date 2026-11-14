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

const NO_PARTNERS = 'None: this change leaves no co-change partner untouched.'

function buildSmallPrBody(
  summary = 'Fixes the CI gap for PR template validation.',
  coChange = NO_PARTNERS,
) {
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

## 🔗 Co-change partners left untouched

${coChange}

---

## ✅ Delivery & Compliance Checklist

- [x] My code passes the ultimate gatekeeper: **\`pnpm pre-commit\` is completely green**.
`
}

function buildLargePrBody(coChange = NO_PARTNERS) {
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

## 🔗 Co-change partners left untouched

${coChange}

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

  it('requires the co-change section and some content in it', () => {
    const without = buildSmallPrBody().replace(
      /## 🔗 Co-change partners left untouched[\s\S]*?---\n\n/,
      '',
    )
    expect(validatePullRequestBody(without)).toContain(
      'Pull request description is missing required section: ## 🔗 Co-change partners left untouched',
    )
    expect(validatePullRequestBody(buildSmallPrBody('Summary.', '<!-- nothing -->'))).toContain(
      '## 🔗 Co-change partners left untouched must contain content.',
    )
  })

  describe('co-change partners', () => {
    const missingPartners = [
      { file: 'src/a.ts', partner: 'src/b.ts', together: 8, fileChanges: 9, confidence: 0.889 },
      { file: 'src/a.ts', partner: 'docs/c.md', together: 5, fileChanges: 9, confidence: 0.556 },
    ]
    const section = (reasonB: string, reasonC: string) =>
      `- \`src/b.ts\` (with \`src/a.ts\`, 8/9): ${reasonB}\n- \`docs/c.md\` (with \`src/a.ts\`, 5/9): ${reasonC}`

    it('passes when every partner is named with a reason', () => {
      const body = buildSmallPrBody('Summary.', section('generated from a.ts', 'not affected'))
      expect(validatePullRequestBody(body, { missingPartners })).toEqual([])
    })

    it('fails when a partner is not named', () => {
      const body = buildSmallPrBody('Summary.', section('generated from a.ts', 'x').split('\n')[0])
      expect(validatePullRequestBody(body, { missingPartners })).toEqual([
        'Co-change partner `docs/c.md` (with `src/a.ts`) is not named.',
      ])
    })

    it('fails on an empty reason and on the <reason> placeholder', () => {
      const body = buildSmallPrBody('Summary.', section('<reason>', ''))
      expect(validatePullRequestBody(body, { missingPartners })).toEqual([
        'Co-change partner `docs/c.md` has no reason.',
        'Co-change partner `src/b.ts` has no reason.',
      ])
    })

    it('passes with no partners as long as the section says so', () => {
      expect(validatePullRequestBody(buildLargePrBody(), { missingPartners: [] })).toEqual([])
    })
  })

  describe('ratchet rises', () => {
    const rise = { path: 'scripts/x-ratchet.json', rule: 'ref-write', from: 485, to: 487 }
    const line = `- \`${rise.path}\` \`ref-write\` 485 -> 487: merge-skew: #701 and #702 collided`
    const withSection = (body: string) =>
      `${body}\n## 📈 Ratchet rises\n\n${body === '' ? '' : line}\n`

    it('passes when no total rose and no rule retired, with or without the section', () => {
      expect(validatePullRequestBody(buildSmallPrBody(), { ratchetRises: [] })).toEqual([])
    })

    it('fails on a rise without the section, and names the section to add', () => {
      const errors = validatePullRequestBody(buildSmallPrBody(), { ratchetRises: [rise] })
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('## 📈 Ratchet rises')
      expect(errors[0]).toContain('1 rise or retirement')
    })

    it('passes with the exact line', () => {
      expect(
        validatePullRequestBody(withSection(buildSmallPrBody()), { ratchetRises: [rise] }),
      ).toEqual([])
    })

    it('fails on a stale line when nothing rose', () => {
      const errors = validatePullRequestBody(withSection(buildSmallPrBody()), { ratchetRises: [] })
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('no rise or retirement')
    })

    it('fails on wrong numbers and on a placeholder reason', () => {
      const wrong = withSection(buildSmallPrBody()).replace('485 -> 487', '485 -> 486')
      expect(validatePullRequestBody(wrong, { ratchetRises: [rise] })[0]).toContain('485 -> 487')

      const placeholder = withSection(buildSmallPrBody()).replace(
        'merge-skew: #701 and #702 collided',
        '<category>: <reason>',
      )
      expect(validatePullRequestBody(placeholder, { ratchetRises: [rise] })).toHaveLength(1)
    })

    it('skips the ratchet part when no diff is known', () => {
      expect(validatePullRequestBody(buildSmallPrBody())).toEqual([])
      expect(validatePullRequestBody(buildSmallPrBody(), { ratchetRises: null })).toEqual([])
    })
  })

  describe('HTML comments', () => {
    const rise = {
      path: 'scripts/x-ratchet.json',
      rule: 'ref-write',
      from: 485,
      to: 487,
    }
    const section = `## 📈 Ratchet rises\n\n- \`${rise.path}\` \`ref-write\` 485 -> 487: detection: wider rule\n`

    it('fails a commented-out ratchet section like a missing one', () => {
      const missing = validatePullRequestBody(buildSmallPrBody(), { ratchetRises: [rise] })
      for (const hidden of [
        `<!--\n${section}-->\n`,
        `<!-- ${section}`,
        `<!-- one line -->\n<!--\n${section}\n--> `,
      ]) {
        const body = `${buildSmallPrBody()}\n${hidden}`
        expect(validatePullRequestBody(body, { ratchetRises: [rise] })).toEqual(missing)
      }
    })

    it('fails a commented-out co-change section like a missing one', () => {
      const partners = [
        { partner: 'a.ts', file: 'b.ts', together: 5, fileChanges: 6, confidence: 0.8 },
      ]
      const body = buildSmallPrBody().replace(
        /## 🔗 Co-change partners left untouched[\s\S]*?---\n/,
        '<!--\n## 🔗 Co-change partners left untouched\n\n- `a.ts` (with `b.ts`, 5/6): because\n-->\n---\n',
      )
      const errors = validatePullRequestBody(body, { missingPartners: partners })
      expect(errors).toEqual([
        'Pull request description is missing required section: ## 🔗 Co-change partners left untouched',
      ])
    })

    it('passes a body that keeps explanatory comments next to real sections', () => {
      const body = `<!--\nexplain the template\n-->\n${buildSmallPrBody().replace(
        '## 📝 What Does This PR Do?\n',
        '## 📝 What Does This PR Do?\n\n<!-- one sentence -->\n',
      )}\n<!-- end -->\n${section}`
      expect(validatePullRequestBody(body, { ratchetRises: [rise] })).toEqual([])
    })

    it('still lets the repository template itself contain comments', () => {
      const template = readFileSync(templatePath, 'utf8')
      expect(template).toContain('<!--')
      expect(validateTemplateStructure(template)).toEqual([])
    })
  })

  describe('fenced code blocks', () => {
    const rise = {
      path: 'scripts/x-ratchet.json',
      rule: 'ref-write',
      from: 485,
      to: 487,
    }
    const printed = `## 📈 Ratchet rises\n\n- \`${rise.path}\` \`ref-write\` 485 -> 487: <category>: <reason>\n`
    const real = `## 📈 Ratchet rises\n\n- \`${rise.path}\` \`ref-write\` 485 -> 487: detection: wider rule\n`
    const fenced = (text: string, fence = '```') => `${fence}\n${text}${fence}\n`
    const missing = validatePullRequestBody(buildSmallPrBody(), { ratchetRises: [rise] })

    it('passes a body with no rise that quotes the printed section in a fence', () => {
      const body = `${buildSmallPrBody()}\nThe command printed:\n\n${fenced(`[x] refused\n\n${printed}`)}\nMore text.\n`
      expect(validatePullRequestBody(body, { ratchetRises: [] })).toEqual([])
    })

    it('does not count a real rise that exists only inside a fence, but counts it outside', () => {
      const inside = `${buildSmallPrBody()}\n${fenced(real)}`
      expect(validatePullRequestBody(inside, { ratchetRises: [rise] })).toEqual(missing)
      const outside = `${buildSmallPrBody()}\n${fenced(printed)}\n${real}`
      expect(validatePullRequestBody(outside, { ratchetRises: [rise] })).toEqual([])
    })

    it('does not count a co-change heading inside a fence', () => {
      const body = buildSmallPrBody().replace(
        /## 🔗 Co-change partners left untouched[\s\S]*?---\n/,
        `${fenced('## 🔗 Co-change partners left untouched\n\nNone: quoted.\n')}---\n`,
      )
      expect(validatePullRequestBody(body)).toEqual([
        'Pull request description is missing required section: ## 🔗 Co-change partners left untouched',
      ])
    })

    it.each([
      ['tilde fences', fenced(real, '~~~')],
      [
        'a four-backtick fence holding a three-backtick line',
        fenced(`\`\`\`\n${real}\`\`\`\n`, '````'),
      ],
      ['an indented fence', `   \`\`\`\n${real}   \`\`\`\n`],
      ['an unterminated fence', `\`\`\`\n${real}`],
    ])('hides a section inside %s', (_name, block) => {
      const body = `${buildSmallPrBody()}\n${block}`
      expect(validatePullRequestBody(body, { ratchetRises: [rise] })).toEqual(missing)
    })

    it('does not close a fence on a shorter or mixed marker', () => {
      const body = `${buildSmallPrBody()}\n\`\`\`\`\n\`\`\`\n~~~~\n${real}\`\`\`\`\n`
      expect(validatePullRequestBody(body, { ratchetRises: [rise] })).toEqual(missing)
    })

    it('treats <!-- inside a fence as text, so a real section after the fence still counts', () => {
      const body = `${buildSmallPrBody()}\n${fenced('<!-- not a comment\n')}\n${real}`
      expect(validatePullRequestBody(body, { ratchetRises: [rise] })).toEqual([])
    })

    it('treats a fence marker inside an HTML comment as text', () => {
      const body = `${buildSmallPrBody()}\n<!--\n\`\`\`\n-->\n${real}`
      expect(validatePullRequestBody(body, { ratchetRises: [rise] })).toEqual([])
    })

    it('still validates the repository template as written', () => {
      expect(validateTemplateStructure(readFileSync(templatePath, 'utf8'))).toEqual([])
    })
  })
})
