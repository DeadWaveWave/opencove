import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

async function runGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync('git', args, {
    cwd,
    env: process.env,
    maxBuffer: 1024 * 1024,
  })

  return {
    stdout: result.stdout?.toString() ?? '',
    stderr: result.stderr?.toString() ?? '',
  }
}

async function createTempRepo(): Promise<string> {
  const repoDir = await mkdtemp(join(tmpdir(), 'cove-worktree-'))

  await runGit(['init'], repoDir)
  await runGit(['config', 'user.email', 'test@example.com'], repoDir)
  await runGit(['config', 'user.name', 'Cove Test'], repoDir)

  await writeFile(join(repoDir, 'README.md'), '# temp\n', 'utf8')
  await runGit(['add', '.'], repoDir)
  await runGit(['commit', '-m', 'init'], repoDir)

  return repoDir
}

describe('GitWorktreeService', () => {
  let repoDir = ''

  afterEach(async () => {
    if (!repoDir) {
      return
    }

    await rm(repoDir, { recursive: true, force: true })
    repoDir = ''
  })

  it('lists worktrees and creates a new worktree under the configured root', async () => {
    repoDir = await createTempRepo()
    const canonicalRepoDir = await realpath(repoDir)
    const worktreesRoot = join(repoDir, '.cove', 'worktrees')
    await mkdir(worktreesRoot, { recursive: true })

    const { createGitWorktree, listGitWorktrees } =
      await import('../../../src/contexts/worktree/infrastructure/git/GitWorktreeService')

    const initial = await listGitWorktrees({ repoPath: canonicalRepoDir })
    expect(initial.worktrees.some(entry => entry.path === canonicalRepoDir)).toBe(true)

    const created = await createGitWorktree({
      repoPath: canonicalRepoDir,
      worktreesRoot,
      branchMode: { kind: 'new', name: 'space-a', startPoint: 'HEAD' },
    })

    expect(created.branch).toBe('space-a')
    expect(created.path.startsWith(await realpath(worktreesRoot))).toBe(true)
    expect(basename(created.path)).toMatch(/^space-a--[0-9a-f]{8}$/)

    const after = await listGitWorktrees({ repoPath: canonicalRepoDir })
    expect(after.worktrees.some(entry => entry.path === created.path)).toBe(true)
  })

  it('removes a created worktree and optionally deletes its branch', async () => {
    repoDir = await createTempRepo()
    const canonicalRepoDir = await realpath(repoDir)
    const worktreesRoot = join(repoDir, '.cove', 'worktrees')
    await mkdir(worktreesRoot, { recursive: true })

    const { createGitWorktree, listGitBranches, listGitWorktrees, removeGitWorktree } =
      await import('../../../src/contexts/worktree/infrastructure/git/GitWorktreeService')

    const created = await createGitWorktree({
      repoPath: canonicalRepoDir,
      worktreesRoot,
      branchMode: { kind: 'new', name: 'space-remove', startPoint: 'HEAD' },
    })

    const removed = await removeGitWorktree({
      repoPath: canonicalRepoDir,
      worktreePath: created.path,
      force: false,
      deleteBranch: true,
    })

    expect(removed).toEqual({
      deletedBranchName: 'space-remove',
      branchDeleteError: null,
    })

    const branchesAfter = await listGitBranches({ repoPath: canonicalRepoDir })
    expect(branchesAfter.branches).not.toContain('space-remove')

    const worktreesAfter = await listGitWorktrees({ repoPath: canonicalRepoDir })
    expect(worktreesAfter.worktrees.some(entry => entry.path === created.path)).toBe(false)
  })

  it('renames the branch checked out by a worktree', async () => {
    repoDir = await createTempRepo()
    const canonicalRepoDir = await realpath(repoDir)
    const worktreesRoot = join(repoDir, '.cove', 'worktrees')
    await mkdir(worktreesRoot, { recursive: true })

    const { createGitWorktree, listGitBranches, listGitWorktrees, renameGitBranch } =
      await import('../../../src/contexts/worktree/infrastructure/git/GitWorktreeService')

    const created = await createGitWorktree({
      repoPath: canonicalRepoDir,
      worktreesRoot,
      branchMode: { kind: 'new', name: 'space-old', startPoint: 'HEAD' },
    })

    await renameGitBranch({
      repoPath: canonicalRepoDir,
      worktreePath: created.path,
      currentName: 'space-old',
      nextName: 'space-new',
    })

    const branchesAfter = await listGitBranches({ repoPath: canonicalRepoDir })
    expect(branchesAfter.branches).toContain('space-new')
    expect(branchesAfter.branches).not.toContain('space-old')

    const worktreesAfter = await listGitWorktrees({ repoPath: canonicalRepoDir })
    expect(worktreesAfter.worktrees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: created.path,
          branch: 'space-new',
        }),
      ]),
    )
  })

  it('rejects adding a worktree for a branch already checked out elsewhere', async () => {
    repoDir = await createTempRepo()
    const canonicalRepoDir = await realpath(repoDir)
    const worktreesRoot = join(repoDir, '.cove', 'worktrees')
    await mkdir(worktreesRoot, { recursive: true })

    const { createGitWorktree } =
      await import('../../../src/contexts/worktree/infrastructure/git/GitWorktreeService')

    await createGitWorktree({
      repoPath: canonicalRepoDir,
      worktreesRoot,
      branchMode: { kind: 'new', name: 'space-b', startPoint: 'HEAD' },
    })

    await expect(
      createGitWorktree({
        repoPath: canonicalRepoDir,
        worktreesRoot,
        branchMode: { kind: 'existing', name: 'space-b' },
      }),
    ).rejects.toThrow(/already checked out/i)
  })
})
