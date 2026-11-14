import { afterEach, describe, expect, it } from 'vitest'
import { guardRatchetUpdate } from '../../../scripts/lib/ratchet-git.mjs'
import {
  createGitRepository,
  removeTemporaryRepositories,
  writeRepositoryFile,
} from './repoFixture'
import {
  baselineJson as baseline,
  commitAll,
  createClonedRepository,
  git,
  removeFixtureDirectories,
} from './ratchetRepoFixture'

afterEach(() => {
  removeTemporaryRepositories()
  removeFixtureDirectories()
})

const PATH = 'scripts/canvas-state-ratchet.json'
const LABEL = 'canvas-state-ratchet'

function guard(
  root: string,
  next: Record<string, Record<string, number>>,
  options: { acceptRises?: string[]; path?: string } = {},
) {
  return guardRatchetUpdate({
    root,
    path: options.path ?? PATH,
    next,
    acceptRises: options.acceptRises ?? [],
    hint: 'Remove the new mentions instead.',
    label: LABEL,
  })
}

describe('guardRatchetUpdate', () => {
  const base = { 'workspace-writer': { 'a.ts': 40, 'b.ts': 5 }, 'ref-write': { 'c.ts': 2 } }

  it('refuses a path that does not end in ratchet.json', () => {
    const { repo } = createClonedRepository()
    expect(() => guard(repo, base, { path: 'scripts/baseline.json' })).toThrow(/ratchet\.json/)
  })

  it('refuses a rise against the merge base and prints the label, the fix and the section', () => {
    const { repo, first } = createClonedRepository({ [PATH]: baseline(base) })

    const result = guard(repo, { ...base, 'workspace-writer': { 'a.ts': 41, 'b.ts': 5 } })

    expect(result.ok).toBe(false)
    expect(result.text).toBe(
      `[${LABEL}] compared with merge base with origin/main (${first.slice(0, 8)}).\n` +
        `[${LABEL}] rise: a.ts [workspace-writer] 40 -> 41\n` +
        `[${LABEL}] workspace-writer: total would rise from 45 to 46.\n` +
        'Refusing to raise the baseline. Remove the new mentions instead.\n' +
        'If the change is intended, rerun with --accept-rise workspace-writer and add this to the\n' +
        'pull request description (the description check fails without it):\n\n' +
        '## 📈 Ratchet rises\n\n' +
        `- \`${PATH}\` \`workspace-writer\` 45 -> 46: <category>: <reason>\n`,
    )
  })

  it('accepts the rise when its rule is named and prints the same section', () => {
    const { repo } = createClonedRepository({ [PATH]: baseline(base) })

    const result = guard(
      repo,
      { ...base, 'workspace-writer': { 'a.ts': 41, 'b.ts': 5 } },
      { acceptRises: ['workspace-writer'] },
    )

    expect(result.ok).toBe(true)
    expect(result.text).toContain('accepted workspace-writer: total would rise from 45 to 46.')
    expect(result.text).toContain(
      `- \`${PATH}\` \`workspace-writer\` 45 -> 46: <category>: <reason>`,
    )
  })

  it('refuses a flag for a rule that neither rises nor retires', () => {
    const { repo } = createClonedRepository({ [PATH]: baseline(base) })

    const result = guard(repo, base, { acceptRises: ['ref-write'] })

    expect(result.ok).toBe(false)
    expect(result.text).toContain('--accept-rise ref-write: this rule neither rises nor retires')
  })

  it('refuses when only some of several risen rules are named', () => {
    const { repo } = createClonedRepository({ [PATH]: baseline(base) })
    const next = { 'workspace-writer': { 'a.ts': 41 }, 'ref-write': { 'c.ts': 3 } }

    const result = guard(
      repo,
      { ...next, 'workspace-writer': { 'a.ts': 46 } },
      {
        acceptRises: ['workspace-writer'],
      },
    )

    expect(result.ok).toBe(false)
    expect(result.text).toContain('ref-write: total would rise from 2 to 3.')
    expect(result.text).toContain('rerun with --accept-rise ref-write and')
  })

  it('accepts a drop, a move between files and a file rename without a flag', () => {
    const { repo } = createClonedRepository({ [PATH]: baseline(base) })

    const drop = guard(repo, { ...base, 'ref-write': { 'c.ts': 1 } })
    expect(drop).toEqual({ ok: true, text: '' })

    const move = guard(repo, {
      'workspace-writer': { 'renamed.ts': 40, 'b.ts': 5 },
      'ref-write': { 'c.ts': 2 },
    })
    expect(move.ok).toBe(true)
    expect(move.text).toContain('rise: renamed.ts [workspace-writer] 0 -> 40')
    expect(move.text).not.toContain('Ratchet rises')
  })

  it('refuses to retire a rule above 0 and accepts a rule removed at 0', () => {
    const { repo } = createClonedRepository({ [PATH]: baseline({ ...base, zero: {} }) })

    const retired = guard(repo, { 'workspace-writer': base['workspace-writer'] })
    expect(retired.ok).toBe(false)
    expect(retired.text).toContain('ref-write: the rule would be removed (its total was 2).')
    expect(retired.text).toContain(`\`ref-write\` 2 -> removed`)

    const accepted = guard(
      repo,
      { 'workspace-writer': base['workspace-writer'] },
      { acceptRises: ['ref-write'] },
    )
    expect(accepted.ok).toBe(true)

    expect(guard(repo, base)).toEqual({ ok: true, text: '' })
  })

  it('compares with the merge base, so deleting the file in a commit does not reset it', () => {
    const { repo } = createClonedRepository({ [PATH]: baseline(base) })
    git(repo, 'rm', '-q', PATH)
    commitAll(repo, 'delete the baseline')

    const raised = guard(repo, { ...base, 'ref-write': { 'c.ts': 3 } })
    expect(raised.ok).toBe(false)
    expect(raised.text).toContain('ref-write: total would rise from 2 to 3.')

    expect(guard(repo, base)).toEqual({ ok: true, text: '' })
  })

  it('treats a file missing from every commit like total 0 and every rule above 0 as a rise', () => {
    const { repo } = createClonedRepository()

    const result = guard(repo, base)

    expect(result.ok).toBe(false)
    expect(result.text).toContain('workspace-writer: total would rise from 0 to 45.')
    expect(result.text).toContain('ref-write: total would rise from 0 to 2.')
  })

  it('compares with none when there is no commit', () => {
    const repo = createGitRepository()

    const result = guard(repo, base, { acceptRises: ['workspace-writer', 'ref-write'] })

    expect(result.ok).toBe(true)
    expect(result.text).toContain('compared with none.')
  })

  it('falls back to HEAD and says how to get the real merge base', () => {
    const repo = createGitRepository()
    writeRepositoryFile(repo, PATH, baseline(base))
    commitAll(repo, 'base')

    const result = guard(repo, { ...base, 'ref-write': { 'c.ts': 3 } })

    expect(result.ok).toBe(false)
    expect(result.text).toContain('compared with HEAD (no origin/main in this clone).')
    expect(result.text).toContain('git fetch --unshallow')
  })

  it('fails with the shape message when the baseline at M is malformed', () => {
    const { repo } = createClonedRepository({ [PATH]: baseline({ r: { 'x.ts': 0 } }) })

    const result = guard(repo, base)

    expect(result.ok).toBe(false)
    expect(result.text).toContain('count must be a positive integer, got 0')
  })

  it('judges several baselines together and names each path in the section', () => {
    const other = 'scripts/ui-style-ratchet.json'
    const { repo } = createClonedRepository({
      [PATH]: baseline(base),
      [other]: baseline({ spacing: { 'a.css': 3 } }),
    })

    const result = guardRatchetUpdate({
      root: repo,
      label: 'ui-style-ratchet',
      updates: [
        { path: PATH, next: base },
        { path: other, next: { spacing: { 'a.css': 4 } } },
      ],
      acceptRises: [],
    })

    expect(result.ok).toBe(false)
    expect(result.text).toContain(`- \`${other}\` \`spacing\` 3 -> 4: <category>: <reason>`)
    expect(result.text).not.toContain(`\`${PATH}\` \``)
  })
})
