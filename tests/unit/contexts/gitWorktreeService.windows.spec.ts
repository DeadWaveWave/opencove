import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('GitWorktreeService (Windows cleanup warnings)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('returns a directory cleanup warning when git unregisters the worktree before reporting a delete failure', async () => {
    const runGitMock = vi.fn()
    const ensureGitRepoMock = vi.fn(async () => undefined)
    const toCanonicalPathMock = vi.fn(async (path: string) => path)
    const toCanonicalPathEvenIfMissingMock = vi.fn(async (path: string) => path)
    const rmMock = vi.fn()
    const statMock = vi.fn()

    let worktreeListCallCount = 0
    let worktreeRemoveCallCount = 0
    runGitMock.mockImplementation(async (args: string[]) => {
      if (args.join(' ') === 'worktree list --porcelain') {
        worktreeListCallCount += 1

        return {
          exitCode: 0,
          stdout:
            worktreeListCallCount === 1
              ? [
                  'worktree C:/repo',
                  'HEAD abc123',
                  'branch refs/heads/main',
                  '',
                  'worktree C:/repo/.opencove/worktrees/space-1',
                  'HEAD def456',
                  'branch refs/heads/feature/demo',
                  '',
                ].join('\n')
              : ['worktree C:/repo', 'HEAD abc123', 'branch refs/heads/main', ''].join('\n'),
          stderr: '',
        }
      }

      if (args[0] === 'worktree' && args[1] === 'remove') {
        worktreeRemoveCallCount += 1

        return worktreeRemoveCallCount === 1
          ? {
              exitCode: 255,
              stdout: '',
              stderr:
                "error: failed to delete 'C:/repo/.opencove/worktrees/space-1': Permission denied",
            }
          : {
              exitCode: 128,
              stdout: '',
              stderr: "fatal: 'C:/repo/.opencove/worktrees/space-1' is not a working tree",
            }
      }

      if (args[0] === 'branch' && args[1] === '-D') {
        return { exitCode: 0, stdout: '', stderr: '' }
      }

      throw new Error(`Unexpected git command: ${args.join(' ')}`)
    })

    statMock.mockResolvedValue({
      isDirectory: () => true,
    })
    rmMock.mockRejectedValue(Object.assign(new Error('busy'), { code: 'EBUSY' }))

    vi.doMock(
      '../../../src/contexts/worktree/infrastructure/git/GitWorktreeService.shared',
      () => ({
        ensureGitRepo: ensureGitRepoMock,
        normalizeOptionalText: (value: string | null | undefined) => {
          if (typeof value !== 'string') {
            return null
          }

          const trimmed = value.trim()
          return trimmed.length > 0 ? trimmed : null
        },
        runGit: runGitMock,
        toCanonicalPath: toCanonicalPathMock,
        toCanonicalPathEvenIfMissing: toCanonicalPathEvenIfMissingMock,
      }),
    )

    const fsPromisesMock = {
      mkdir: vi.fn(),
      readdir: vi.fn(),
      rm: rmMock,
      stat: statMock,
    }

    vi.doMock('node:fs/promises', () => ({
      ...fsPromisesMock,
      default: fsPromisesMock,
    }))

    const { removeGitWorktree } =
      await import('../../../src/contexts/worktree/infrastructure/git/GitWorktreeService')

    const removed = await removeGitWorktree({
      repoPath: 'C:/repo',
      worktreePath: 'C:/repo/.opencove/worktrees/space-1',
      force: false,
      deleteBranch: true,
    })

    expect(statMock).toHaveBeenCalled()
    expect(rmMock).toHaveBeenCalledTimes(6)
    expect(worktreeRemoveCallCount).toBe(2)
    expect(removed).toEqual({
      deletedBranchName: 'feature/demo',
      branchDeleteError: null,
      directoryCleanupError: expect.objectContaining({
        code: 'worktree.remove_directory_cleanup_failed',
      }),
    })
    expect(runGitMock).toHaveBeenCalledWith(
      ['worktree', 'remove', 'C:/repo/.opencove/worktrees/space-1'],
      'C:/repo',
    )
    expect(runGitMock).toHaveBeenCalledWith(['branch', '-D', 'feature/demo'], 'C:/repo')
  })
})
