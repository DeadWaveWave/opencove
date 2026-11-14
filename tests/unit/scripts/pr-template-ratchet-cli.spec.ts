import { spawnSync } from 'node:child_process'
import { cpSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  baselineJson,
  commitAll,
  createTemporaryDirectory,
  git,
  publishToOrigin,
  removeFixtureDirectories,
} from './ratchetRepoFixture'
import {
  createGitRepository,
  removeTemporaryRepositories,
  repositoryRoot,
  writeRepositoryFile,
} from './repoFixture'

afterEach(() => {
  removeTemporaryRepositories()
  removeFixtureDirectories()
})

const BASELINE = 'config/guard-ratchet.json'
const OTHER = 'config/other-ratchet.json'
const SECTION = '## 📈 Ratchet rises'
const MERGE_BASE_RULES = { alpha: { 'a.ts': 3 }, beta: { 'b.ts': 2 } }

function body(extra = ''): string {
  return `## 💡 Change Scope

- [x] **Small Change**: Fast feedback, localized UI/logic, low-risk.
- [ ] **Large Change**: New feature, cross-boundary logic, runtime-risk (persistence, IPC, lifecycle, recovery).

## 📝 What Does This PR Do?

Changes a ratchet baseline.

---

## 🏗️ Large Change Spec (Required if "Large Change" is checked)

**1. Context & Business Logic**

**2. State Ownership & Invariants**

**3. Verification Plan & Regression Layer**

---

## 🔗 Co-change partners left untouched

None: this change leaves no co-change partner untouched.

${extra}
---

## ✅ Delivery & Compliance Checklist

- [x] My code passes the ultimate gatekeeper: **\`pnpm pre-commit\` is completely green**.
`
}

// A copy of the validator scripts in a repository whose origin/main holds one baseline, then a
// branch on top of it. The repository's own baselines are left out of the copy.
function createRepository() {
  const repo = createGitRepository()
  cpSync(join(repositoryRoot, 'scripts'), join(repo, 'scripts'), {
    recursive: true,
    filter: source => !source.endsWith('ratchet.json'),
  })
  cpSync(
    join(repositoryRoot, '.github/pull_request_template.md'),
    join(repo, '.github/pull_request_template.md'),
  )
  writeRepositoryFile(repo, BASELINE, baselineJson(MERGE_BASE_RULES))
  publishToOrigin(repo)
  git(repo, 'checkout', '-q', '-b', 'feature')
  return repo
}

function check(repo: string, text: string, args = ['--base', 'origin/main', '--head', 'HEAD']) {
  const bodyDirectory = createTemporaryDirectory('opencove-pr-body-')
  writeRepositoryFile(bodyDirectory, 'body.md', text)
  return spawnSync(
    process.execPath,
    [join(repo, 'scripts/check-pr-template.mjs'), join(bodyDirectory, 'body.md'), ...args],
    { cwd: repo, encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_PATH: '' } },
  )
}

const line = (path: string, rule: string, numbers: string, reason: string) =>
  `- \`${path}\` \`${rule}\` ${numbers}: ${reason}`

describe('check-pr-template ratchet rises', () => {
  it('passes when no total rose and no rule retired', () => {
    const repo = createRepository()
    writeRepositoryFile(repo, BASELINE, baselineJson({ alpha: { 'z.ts': 3 }, beta: { 'b.ts': 1 } }))
    commitAll(repo, 'move and drop')

    const result = check(repo, body())

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('fails on a hand edit of +1, prints the section to paste, and passes once it is added', () => {
    const repo = createRepository()
    writeRepositoryFile(repo, BASELINE, baselineJson({ ...MERGE_BASE_RULES, alpha: { 'a.ts': 4 } }))
    commitAll(repo, 'raise alpha by hand')

    const failed = check(repo, body())
    expect(failed.status).toBe(1)
    expect(failed.stderr).toContain(`${SECTION} is required`)
    expect(failed.stderr).toContain(
      `${SECTION}\n\n- \`${BASELINE}\` \`alpha\` 3 -> 4: <category>: <reason>`,
    )

    const section = `${SECTION}\n\n${line(BASELINE, 'alpha', '3 -> 4', 'detection: the rule sees more')}\n`
    const passed = check(repo, body(section))
    expect(passed.stderr).toBe('')
    expect(passed.status).toBe(0)
  })

  it.each([
    {
      name: 'deleting the file',
      change: (repo: string) => git(repo, 'rm', '-q', BASELINE),
      lines: [
        line(
          BASELINE,
          'alpha',
          '3 -> removed',
          'rename: the baseline file was removed with its check',
        ),
        line(
          BASELINE,
          'beta',
          '2 -> removed',
          'rename: the baseline file was removed with its check',
        ),
      ],
    },
    {
      name: 'renaming a rule',
      change: (repo: string) =>
        writeRepositoryFile(
          repo,
          BASELINE,
          baselineJson({ gamma: { 'a.ts': 3 }, beta: MERGE_BASE_RULES.beta }),
        ),
      lines: [
        line(BASELINE, 'alpha', '3 -> removed', 'rename: renamed to gamma'),
        line(BASELINE, 'gamma', '0 -> 3', 'new-rule: alpha was renamed to gamma'),
      ],
    },
    {
      name: 'splitting a rule',
      change: (repo: string) =>
        writeRepositoryFile(
          repo,
          BASELINE,
          baselineJson({
            'alpha.x': { 'a.ts': 2 },
            'alpha.y': { 'a.ts': 1 },
            beta: MERGE_BASE_RULES.beta,
          }),
        ),
      lines: [
        line(BASELINE, 'alpha', '3 -> removed', 'rename: split into alpha.x and alpha.y'),
        line(BASELINE, 'alpha.x', '0 -> 2', 'new-rule: half of alpha'),
        line(BASELINE, 'alpha.y', '0 -> 1', 'new-rule: the other part of alpha'),
      ],
    },
    {
      name: 'adding a new ratchet',
      change: (repo: string) =>
        writeRepositoryFile(repo, OTHER, baselineJson({ fresh: { 'c.ts': 1 }, empty: {} })),
      lines: [line(OTHER, 'fresh', '0 -> 1', 'new-rule: a new ratchet for the fresh rule')],
    },
  ])('fails on $name without lines and passes with them', ({ change, lines }) => {
    const repo = createRepository()
    change(repo)
    commitAll(repo, 'change the baselines')

    const failed = check(repo, body())
    expect(failed.status).toBe(1)
    for (const text of lines) {
      const [head] = text.split(': ')
      expect(failed.stderr).toContain(`${head}: <category>: <reason>`)
    }

    const passed = check(repo, body(`${SECTION}\n\n${lines.join('\n')}\n`))
    expect(passed.stderr).toBe('')
    expect(passed.status).toBe(0)
  })

  it('fails on a stale line, wrong numbers, a missing category and merge-skew without #N', () => {
    const repo = createRepository()
    writeRepositoryFile(repo, BASELINE, baselineJson({ ...MERGE_BASE_RULES, alpha: { 'a.ts': 4 } }))
    commitAll(repo, 'raise alpha')
    const attempt = (reason: string, numbers = '3 -> 4') =>
      check(repo, body(`${SECTION}\n\n${line(BASELINE, 'alpha', numbers, reason)}\n`))

    expect(attempt('detection: wider rule').status).toBe(0)
    expect(attempt('detection: wider rule', '3 -> 5').stderr).toContain('3 -> 4')
    expect(attempt('it grew').stderr).toContain('merge-skew:')
    expect(attempt('merge-skew: two branches collided').stderr).toContain('#N')
    expect(attempt('<category>: <reason>').status).toBe(1)

    const stale = check(
      repo,
      body(
        `${SECTION}\n\n${line(BASELINE, 'alpha', '3 -> 4', 'detection: wider rule')}\n${line(BASELINE, 'beta', '2 -> 3', 'detection: wider rule')}\n`,
      ),
    )
    expect(stale.status).toBe(1)
    expect(stale.stderr).toContain('no rise or retirement')
  })

  it('skips the ratchet part when no diff range is given', () => {
    const repo = createRepository()
    writeRepositoryFile(repo, BASELINE, baselineJson({ ...MERGE_BASE_RULES, alpha: { 'a.ts': 9 } }))
    commitAll(repo, 'raise alpha')

    const result = check(repo, body(), [])

    expect(result.status).toBe(0)
  })

  it('reads M and H from the pull request event, with M the merge base of the two SHAs', () => {
    const repo = createRepository()
    const mergeBase = git(repo, 'rev-parse', 'main')
    git(repo, 'checkout', '-q', 'main')
    writeRepositoryFile(repo, 'unrelated.txt', 'x\n')
    const base = commitAll(repo, 'main moved on')
    git(repo, 'checkout', '-q', 'feature')
    writeRepositoryFile(repo, BASELINE, baselineJson({ ...MERGE_BASE_RULES, alpha: { 'a.ts': 4 } }))
    const head = commitAll(repo, 'raise alpha')
    expect(mergeBase).not.toBe(base)

    const directory = createTemporaryDirectory('opencove-event-')
    writeRepositoryFile(
      directory,
      'event.json',
      JSON.stringify({
        pull_request: { body: body(), base: { sha: base }, head: { sha: head } },
      }),
    )
    const result = spawnSync(process.execPath, [join(repo, 'scripts/check-pr-template.mjs')], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_EVENT_PATH: join(directory, 'event.json') },
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`\`${BASELINE}\` \`alpha\` 3 -> 4`)
    rmSync(directory, { recursive: true, force: true })
  })
})
