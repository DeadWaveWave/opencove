import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  WORKING_TREE,
  collectRatchetRises,
  listBaselinesAt,
  parseAcceptRises,
  readBaselineAt,
  resolveMergeBase,
} from '../../../scripts/lib/ratchet-git.mjs'
import { runRatchetRises } from '../../../scripts/ratchet-rises.mjs'
import { validateRiseSection } from '../../../scripts/lib/ratchet.mjs'
import {
  createGitRepository,
  removeTemporaryRepositories,
  runGit,
  writeRepositoryFile,
} from './repoFixture'
import {
  baselineJson as baseline,
  commitAll,
  createClonedRepository,
  createTemporaryDirectory,
  git,
  removeFixtureDirectories,
} from './ratchetRepoFixture'

afterEach(() => {
  removeTemporaryRepositories()
  removeFixtureDirectories()
})

describe('resolveMergeBase', () => {
  it('is the merge base with origin/main when the branch is ahead', () => {
    const { repo, first } = createClonedRepository()
    git(repo, 'checkout', '-q', '-b', 'feature')
    writeRepositoryFile(repo, 'a.txt', 'a\n')
    commitAll(repo, 'feature work')

    const result = resolveMergeBase(repo, 'origin/main', 'HEAD')

    expect(result.rev).toBe(first)
    expect(result.fallback).toBe(false)
    expect(result.label).toBe(`merge base with origin/main (${first.slice(0, 8)})`)
  })

  it('stays the same across unpushed commits on main and on a detached HEAD', () => {
    const { repo, first } = createClonedRepository()
    writeRepositoryFile(repo, 'a.txt', 'a\n')
    commitAll(repo, 'unpushed one')
    writeRepositoryFile(repo, 'b.txt', 'b\n')
    const second = commitAll(repo, 'unpushed two')

    expect(resolveMergeBase(repo, 'origin/main', 'HEAD').rev).toBe(first)
    git(repo, 'checkout', '-q', '--detach', second)
    expect(resolveMergeBase(repo, 'origin/main', 'HEAD').rev).toBe(first)
  })

  it('falls back to HEAD with a labelled reason when there is no origin/main', () => {
    const repo = createGitRepository()
    writeRepositoryFile(repo, 'README.md', 'x\n')
    const head = commitAll(repo, 'base')

    const result = resolveMergeBase(repo, 'origin/main', 'HEAD')

    expect(result.rev).toBe(head)
    expect(result.fallback).toBe(true)
    expect(result.label).toMatch(/^HEAD \(.*origin\/main.*\)$/)
    expect(result.hint).toContain('git fetch --unshallow')
  })

  it('falls back to HEAD in a shallow clone that lacks the merge base', () => {
    const { repo, origin } = createClonedRepository()
    git(repo, 'checkout', '-q', '-b', 'feature')
    writeRepositoryFile(repo, 'f.txt', 'f\n')
    commitAll(repo, 'feature')
    git(repo, 'checkout', '-q', 'main')
    writeRepositoryFile(repo, 'm1.txt', 'm\n')
    commitAll(repo, 'main one')
    writeRepositoryFile(repo, 'm2.txt', 'm\n')
    commitAll(repo, 'main two')
    git(repo, 'push', '-q', 'origin', 'main', 'feature')

    const clone = createTemporaryDirectory('opencove-repo-shallow-')
    runGit(
      ['clone', '-q', '--depth', '1', '--branch', 'feature', `file://${origin}`, clone],
      tmpdir(),
    )
    git(clone, 'fetch', '-q', '--depth', '1', 'origin', 'main:refs/remotes/origin/main')

    const result = resolveMergeBase(clone, 'origin/main', 'HEAD')

    expect(result.fallback).toBe(true)
    expect(result.rev).toBe(git(clone, 'rev-parse', 'HEAD'))
    expect(result.label).toMatch(/^HEAD \(no merge base/)
    expect(result.hint).toContain('git fetch --unshallow')
  })

  it('has no revision at all before the first commit or outside a repository', () => {
    const empty = createGitRepository()
    expect(resolveMergeBase(empty, 'origin/main', 'HEAD')).toMatchObject({
      rev: null,
      label: 'none',
      fallback: false,
    })

    const outside = createTemporaryDirectory('opencove-no-repo-')
    expect(resolveMergeBase(outside, 'origin/main', 'HEAD')).toMatchObject({
      rev: null,
      label: 'none',
    })
  })
})

describe('baseline discovery', () => {
  it('lists tracked paths ending in ratchet.json and ignores everything else', () => {
    const { repo } = createClonedRepository({
      'scripts/a-ratchet.json': baseline({ r: { 'x.ts': 1 } }),
      'harness/ratchet.json': baseline({}),
      'scripts/not-a-baseline.json': 'not json',
      'scripts/ratchet.json.bak': 'not json',
    })

    expect(listBaselinesAt(repo, 'HEAD')).toEqual([
      'harness/ratchet.json',
      'scripts/a-ratchet.json',
    ])
    expect(listBaselinesAt(repo, null)).toEqual([])
  })

  it('reads a baseline at a revision, null when absent, and throws when malformed', () => {
    const { repo } = createClonedRepository({
      'scripts/a-ratchet.json': baseline({ r: { 'x.ts': 2 } }),
      'scripts/bad-ratchet.json': baseline({ r: { 'x.ts': 0 } }),
    })

    expect(readBaselineAt(repo, 'HEAD', 'scripts/a-ratchet.json')).toEqual({ r: { 'x.ts': 2 } })
    expect(readBaselineAt(repo, 'HEAD', 'scripts/missing-ratchet.json')).toBeNull()
    expect(readBaselineAt(repo, null, 'scripts/a-ratchet.json')).toBeNull()
    expect(() => readBaselineAt(repo, 'HEAD', 'scripts/bad-ratchet.json')).toThrow(
      /\[ratchet\] scripts\/bad-ratchet\.json at [0-9a-f]{8}: rule "r", file "x\.ts": count must be a positive integer, got 0/,
    )
  })

  it('reads the working tree for H', () => {
    const { repo } = createClonedRepository({
      'scripts/a-ratchet.json': baseline({ r: { 'x.ts': 1 } }),
    })
    writeRepositoryFile(repo, 'scripts/a-ratchet.json', baseline({ r: { 'x.ts': 5 } }))
    writeRepositoryFile(repo, 'scripts/new-ratchet.json', baseline({ s: { 'y.ts': 1 } }))

    expect(listBaselinesAt(repo, WORKING_TREE)).toEqual([
      'scripts/a-ratchet.json',
      'scripts/new-ratchet.json',
    ])
    expect(readBaselineAt(repo, WORKING_TREE, 'scripts/a-ratchet.json')).toEqual({
      r: { 'x.ts': 5 },
    })
  })
})

describe('collectRatchetRises', () => {
  it('compares the union of paths at M and H: a file only at M retires, a file only at H rises from 0', () => {
    const { repo, first } = createClonedRepository({
      'scripts/old-ratchet.json': baseline({ gone: { 'a.ts': 4 }, zero: {} }),
      'scripts/kept-ratchet.json': baseline({ same: { 'a.ts': 2 }, grows: { 'a.ts': 1 } }),
    })
    git(repo, 'rm', '-q', 'scripts/old-ratchet.json')
    writeRepositoryFile(
      repo,
      'scripts/kept-ratchet.json',
      baseline({ same: { 'b.ts': 2 }, grows: { 'a.ts': 3 } }),
    )
    writeRepositoryFile(
      repo,
      'scripts/new-ratchet.json',
      baseline({ fresh: { 'c.ts': 6 }, empty: {} }),
    )
    const head = commitAll(repo, 'change baselines')

    expect(collectRatchetRises(repo, first, head)).toEqual([
      { path: 'scripts/kept-ratchet.json', rule: 'grows', from: 1, to: 3 },
      { path: 'scripts/new-ratchet.json', rule: 'fresh', from: 0, to: 6 },
      { path: 'scripts/old-ratchet.json', rule: 'gone', from: 4, to: null },
    ])
  })

  it('reports nothing when no total changed, and everything as rises when M is none', () => {
    const { repo, first } = createClonedRepository({
      'scripts/a-ratchet.json': baseline({ r: { 'x.ts': 2 } }),
    })
    expect(collectRatchetRises(repo, first, WORKING_TREE)).toEqual([])
    expect(collectRatchetRises(repo, null, 'HEAD')).toEqual([
      { path: 'scripts/a-ratchet.json', rule: 'r', from: 0, to: 2 },
    ])
  })
})

describe('parseAcceptRises', () => {
  it('collects every --accept-rise value and hands back the rest', () => {
    expect(
      parseAcceptRises(['--update-ratchet', '--accept-rise', 'a', '--accept-rise=b.c', '--other']),
    ).toEqual({ rules: ['a', 'b.c'], rest: ['--update-ratchet', '--other'] })
  })

  it('refuses a flag without a rule id', () => {
    expect(() => parseAcceptRises(['--accept-rise'])).toThrow(/--accept-rise needs a rule id/)
    expect(() => parseAcceptRises(['--accept-rise', '--update-ratchet'])).toThrow(
      /--accept-rise needs a rule id/,
    )
  })
})

describe('pnpm ratchet:rises', () => {
  function run(root: string) {
    let out = ''
    let err = ''
    const code = runRatchetRises({
      root,
      stdout: { write: (text: string) => (out += text) },
      stderr: { write: (text: string) => (err += text) },
    })
    return { code, out, err }
  }

  it('prints a section that passes the validator for the same M and H once reasons are filled in', () => {
    const { repo, first } = createClonedRepository({
      'scripts/a-ratchet.json': baseline({ r: { 'x.ts': 2 }, gone: { 'x.ts': 1 } }),
    })
    git(repo, 'checkout', '-q', '-b', 'feature')
    writeRepositoryFile(repo, 'scripts/a-ratchet.json', baseline({ r: { 'x.ts': 5 } }))
    writeRepositoryFile(repo, 'scripts/b-ratchet.json', baseline({ s: { 'y.ts': 1 } }))
    const head = commitAll(repo, 'raise')

    const { code, out, err } = run(repo)

    expect(code).toBe(0)
    expect(err).toContain(
      `compared the working tree with merge base with origin/main (${first.slice(0, 8)})`,
    )
    expect(out.startsWith('## 📈 Ratchet rises\n')).toBe(true)
    const filled = out
      .split('\n')
      .map(line => line.replace('<category>: <reason>', 'detection: the rule sees more'))
      .join('\n')
    const entries = collectRatchetRises(repo, first, head)
    expect(entries).toHaveLength(3)
    expect(validateRiseSection(filled.replace('## 📈 Ratchet rises', ''), entries)).toEqual([])
    expect(validateRiseSection(out.replace('## 📈 Ratchet rises', ''), entries)).not.toEqual([])
  })

  it('says so when nothing rose', () => {
    const { repo } = createClonedRepository({
      'scripts/a-ratchet.json': baseline({ r: { 'x.ts': 2 } }),
    })

    const { code, out, err } = run(repo)

    expect(code).toBe(0)
    expect(out).toBe('')
    expect(err).toContain('no rise or retirement')
  })

  it('fails with the shape message on a malformed baseline', () => {
    const { repo } = createClonedRepository()
    writeRepositoryFile(repo, 'scripts/bad-ratchet.json', baseline({ r: { 'x.ts': 0 } }))

    const { code, err } = run(repo)

    expect(code).toBe(1)
    expect(err).toContain('count must be a positive integer, got 0')
  })
})
