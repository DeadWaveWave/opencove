import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveNightlyReleaseGate } from '../../../scripts/lib/nightly-release-gate.mjs'

const temporaryRepositories: string[] = []

function runGit(args: string[], cwd: string): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    stdio: 'pipe',
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `git ${args.join(' ')} failed.`)
  }

  return result.stdout.trim()
}

function createRepository(): string {
  const repoPath = mkdtempSync(join(tmpdir(), 'opencove-nightly-release-gate-'))
  temporaryRepositories.push(repoPath)

  runGit(['init'], repoPath)
  runGit(['config', 'user.email', 'test@example.com'], repoPath)
  runGit(['config', 'user.name', 'OpenCove Test'], repoPath)
  runGit(['config', 'core.autocrlf', 'false'], repoPath)
  runGit(['config', 'core.safecrlf', 'false'], repoPath)

  return repoPath
}

function commitFile(repoPath: string, fileName: string, content: string, message: string): void {
  writeFileSync(join(repoPath, fileName), content)
  runGit(['add', fileName], repoPath)
  runGit(['commit', '-m', message], repoPath)
}

afterEach(() => {
  for (const repoPath of temporaryRepositories.splice(0)) {
    rmSync(repoPath, { recursive: true, force: true })
  }
})

describe('nightly release gate', () => {
  it('builds scheduled nightlies when no prior tag exists', () => {
    const repoPath = createRepository()
    commitFile(repoPath, 'app.txt', 'initial\n', 'initial commit')

    expect(
      resolveNightlyReleaseGate({
        cwd: repoPath,
        eventName: 'schedule',
        greenCommit: runGit(['rev-parse', 'HEAD'], repoPath),
      }),
    ).toEqual({
      previousTag: null,
      commitCountSinceTag: 0,
      hasChanges: true,
      shouldRelease: true,
      reason: 'no_previous_tag',
    })
  })

  it('skips scheduled nightlies when HEAD already matches the previous tag', () => {
    const repoPath = createRepository()
    commitFile(repoPath, 'app.txt', 'initial\n', 'initial commit')
    runGit(['tag', 'v0.2.0-nightly.20260520.1'], repoPath)

    expect(
      resolveNightlyReleaseGate({
        cwd: repoPath,
        eventName: 'schedule',
        greenCommit: runGit(['rev-parse', 'HEAD'], repoPath),
      }),
    ).toEqual({
      previousTag: 'v0.2.0-nightly.20260520.1',
      commitCountSinceTag: 0,
      hasChanges: false,
      shouldRelease: false,
      reason: 'no_changes_since_tag',
    })
  })

  it('builds scheduled nightlies when the target diverges from the previous tag', () => {
    const repoPath = createRepository()
    commitFile(repoPath, 'app.txt', 'initial\n', 'initial commit')
    runGit(['tag', 'v0.2.0-nightly.20260520.1'], repoPath)
    commitFile(repoPath, 'app.txt', 'initial\nnext\n', 'next commit')

    expect(
      resolveNightlyReleaseGate({
        cwd: repoPath,
        eventName: 'schedule',
        greenCommit: runGit(['rev-parse', 'HEAD'], repoPath),
      }),
    ).toEqual({
      previousTag: 'v0.2.0-nightly.20260520.1',
      commitCountSinceTag: 1,
      hasChanges: true,
      shouldRelease: true,
      reason: 'changed_since_tag',
    })
  })

  it('skips scheduled nightlies when later commits revert back to the tagged tree', () => {
    const repoPath = createRepository()
    commitFile(repoPath, 'app.txt', 'initial\n', 'initial commit')
    runGit(['tag', 'v0.2.0-nightly.20260520.1'], repoPath)
    commitFile(repoPath, 'app.txt', 'initial\nnext\n', 'add change')
    commitFile(repoPath, 'app.txt', 'initial\n', 'revert change')

    expect(
      resolveNightlyReleaseGate({
        cwd: repoPath,
        eventName: 'schedule',
        greenCommit: runGit(['rev-parse', 'HEAD'], repoPath),
      }),
    ).toEqual({
      previousTag: 'v0.2.0-nightly.20260520.1',
      commitCountSinceTag: 2,
      hasChanges: false,
      shouldRelease: false,
      reason: 'no_changes_since_tag',
    })
  })

  it('keeps manual dispatch as an explicit override', () => {
    const repoPath = createRepository()
    commitFile(repoPath, 'app.txt', 'initial\n', 'initial commit')
    runGit(['tag', 'v0.2.0-nightly.20260520.1'], repoPath)

    expect(resolveNightlyReleaseGate({ cwd: repoPath, eventName: 'workflow_dispatch' })).toEqual({
      previousTag: 'v0.2.0-nightly.20260520.1',
      commitCountSinceTag: 0,
      hasChanges: false,
      shouldRelease: true,
      reason: 'manual_override',
    })
  })

  it('releases the newest green commit when it is the head', () => {
    const repoPath = createRepository()
    commitFile(repoPath, 'app.txt', 'initial\n', 'initial commit')
    runGit(['tag', 'v0.2.0-nightly.20260520.1'], repoPath)
    commitFile(repoPath, 'app.txt', 'initial\nnext\n', 'green head')
    const head = runGit(['rev-parse', 'HEAD'], repoPath)

    expect(
      resolveNightlyReleaseGate({ cwd: repoPath, eventName: 'schedule', greenCommit: head }),
    ).toMatchObject({ shouldRelease: true, reason: 'changed_since_tag', commitCountSinceTag: 1 })
  })

  it('releases an older green commit, not the head, and judges changes against it', () => {
    const repoPath = createRepository()
    commitFile(repoPath, 'app.txt', 'initial\n', 'initial commit')
    runGit(['tag', 'v0.2.0-nightly.20260520.1'], repoPath)
    commitFile(repoPath, 'app.txt', 'initial\nnext\n', 'green commit')
    const green = runGit(['rev-parse', 'HEAD'], repoPath)
    commitFile(repoPath, 'app.txt', 'initial\nnext\nbroken\n', 'red commit')
    commitFile(repoPath, 'app.txt', 'initial\nnext\nbroken\nmore\n', 'newer head')

    expect(
      resolveNightlyReleaseGate({ cwd: repoPath, eventName: 'schedule', greenCommit: green }),
    ).toEqual({
      previousTag: 'v0.2.0-nightly.20260520.1',
      commitCountSinceTag: 1,
      hasChanges: true,
      shouldRelease: true,
      reason: 'changed_since_tag',
    })
  })

  it('skips an older green commit that matches the previous tag, even when the head changed', () => {
    const repoPath = createRepository()
    commitFile(repoPath, 'app.txt', 'initial\n', 'initial commit')
    runGit(['tag', 'v0.2.0-nightly.20260520.1'], repoPath)
    const green = runGit(['rev-parse', 'HEAD'], repoPath)
    commitFile(repoPath, 'app.txt', 'initial\nnext\n', 'newer head')

    expect(
      resolveNightlyReleaseGate({ cwd: repoPath, eventName: 'schedule', greenCommit: green }),
    ).toMatchObject({ shouldRelease: false, reason: 'no_changes_since_tag' })
  })

  it.each([null, undefined, ''])(
    'skips scheduled nightlies with no green run (%j)',
    greenCommit => {
      const repoPath = createRepository()
      commitFile(repoPath, 'app.txt', 'initial\n', 'initial commit')

      expect(
        resolveNightlyReleaseGate({ cwd: repoPath, eventName: 'schedule', greenCommit }),
      ).toEqual({
        previousTag: null,
        commitCountSinceTag: 0,
        hasChanges: false,
        shouldRelease: false,
        reason: 'no_green_ci_run',
      })
    },
  )

  it('keeps manual dispatch on the requested target whatever the green commit is', () => {
    const repoPath = createRepository()
    commitFile(repoPath, 'app.txt', 'initial\n', 'initial commit')
    const older = runGit(['rev-parse', 'HEAD'], repoPath)
    commitFile(repoPath, 'app.txt', 'initial\nnext\n', 'head')

    expect(
      resolveNightlyReleaseGate({
        cwd: repoPath,
        eventName: 'workflow_dispatch',
        targetRef: 'HEAD',
        greenCommit: older,
      }),
    ).toMatchObject({ shouldRelease: true, reason: 'no_previous_tag', commitCountSinceTag: 0 })
    expect(
      resolveNightlyReleaseGate({
        cwd: repoPath,
        eventName: 'workflow_dispatch',
        targetRef: 'HEAD',
      }),
    ).toMatchObject({ shouldRelease: true })
  })
})
