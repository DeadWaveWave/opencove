// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerGitWorktreeHandlers } from '../../../src/app/main/controlSurface/handlers/gitWorktreeHandlers'
import { registerGitWorktreeMountHandlers } from '../../../src/app/main/controlSurface/handlers/gitWorktreeMountHandlers'
import type { WorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'
import { getControlSurfaceOperation } from '../../../src/shared/contracts/controlSurface/operations'
import type { AppErrorCode } from '../../../src/shared/contracts/dto'
import { runCommand } from '../../../src/platform/process/runCommand'

vi.mock('../../../src/platform/process/runCommand', () => ({ runCommand: vi.fn() }))
vi.mock('../../../src/platform/os/CommandEnvironmentService', () => ({
  getCommandExecutionEnvironment: async () => ({}),
}))

let root: string
let worktreePath: string
beforeAll(async () => {
  const temporaryRoot = resolve('.codex-out/tmp')
  await mkdir(temporaryRoot, { recursive: true })
  root = await realpath(await mkdtemp(resolve(temporaryRoot, 'git-error-contract-')))
  worktreePath = resolve(root, 'feature')
  await mkdir(worktreePath)
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})
beforeEach(() => {
  vi.mocked(runCommand).mockReset()
})

function surface() {
  const controlSurface = createControlSurface()
  const approvedWorkspaces = {
    isPathApproved: async () => true,
    registerRoot: async () => undefined,
  }
  registerGitWorktreeHandlers(controlSurface, { approvedWorkspaces })
  registerGitWorktreeMountHandlers(controlSurface, {
    approvedWorkspaces,
    topology: {
      resolveMountTarget: async () => ({
        mountId: 'mount-1',
        endpointId: 'local',
        rootPath: root,
        rootUri: pathToFileURL(root).href,
      }),
    } as unknown as WorkerTopologyStore,
  })
  return controlSurface
}

async function expectFailure(id: string, code: AppErrorCode) {
  const operation = getControlSurfaceOperation(id)
  if (operation?.contract !== 'schema') {
    throw new Error('Expected migrated operation: ' + id)
  }
  const result = await surface().invoke(
    { now: () => new Date() },
    {
      id,
      kind: operation.kind,
      payload: {
        repoPath: root,
        mountId: 'mount-1',
        uri: pathToFileURL(root).href,
        worktreePath,
        worktreeUri: pathToFileURL(worktreePath).href,
        worktreesRoot: root,
        worktreesRootUri: pathToFileURL(root).href,
        branchMode: { kind: 'new', name: 'feature', startPoint: 'main' },
        currentName: 'feature',
        nextName: 'renamed',
        force: false,
      },
    },
  )
  expect(result).toMatchObject({ ok: false, error: { code } })
  expect(operation.errors).toContain(code)
  expect(runCommand).toHaveBeenCalled()
  return result
}

const repositoryOperations = [
  'create',
  'remove',
  'renameBranch',
  'listBranches',
  'listWorktrees',
  'statusSummary',
  'graph',
  'getDefaultBranch',
]
for (const suffix of ['', 'InMount']) {
  for (const action of repositoryOperations) {
    const id = `gitWorktree.${action}${suffix}`
    it(`${id} declares unavailable Git from the real service`, async () => {
      vi.mocked(runCommand).mockRejectedValue(
        Object.assign(new Error('git missing'), { code: 'ENOENT' }),
      )
      await expectFailure(id, 'worktree.git_unavailable')
    })
    it(`${id} declares the real non-repository failure`, async () => {
      vi.mocked(runCommand).mockResolvedValue({
        exitCode: 128,
        stdout: '',
        stderr: 'Not a git repository',
      })
      await expectFailure(id, 'worktree.not_a_git_repo')
    })
  }
  it(`gitWorktree.create${suffix} declares an unborn HEAD`, async () => {
    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes('--is-inside-work-tree')) {
        return { exitCode: 0, stdout: 'true', stderr: '' }
      }
      expect(args).toEqual(['rev-parse', '--verify', '--quiet', 'HEAD'])
      return { exitCode: 1, stdout: '', stderr: '' }
    })
    await expectFailure(`gitWorktree.create${suffix}`, 'worktree.repo_has_no_commits')
  })
  it(`gitWorktree.remove${suffix} declares dirty worktrees before mutation`, async () => {
    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes('--is-inside-work-tree')) {
        return { exitCode: 0, stdout: 'true', stderr: '' }
      }
      if (args[0] === 'worktree' && args[1] === 'list') {
        return {
          exitCode: 0,
          stdout: `worktree ${worktreePath}\nHEAD abc\nbranch refs/heads/feature\n`,
          stderr: '',
        }
      }
      expect(args).toEqual(['status', '--porcelain', '--untracked-files=all'])
      return { exitCode: 0, stdout: ' M changed.txt\n', stderr: '' }
    })
    const result = await expectFailure(
      `gitWorktree.remove${suffix}`,
      'worktree.remove_uncommitted_changes',
    )
    expect(result).toMatchObject({ error: { params: { changedFileCount: 1 } } })
    expect(
      vi
        .mocked(runCommand)
        .mock.calls.some(([, args]) => args[0] === 'worktree' && args[1] === 'remove'),
    ).toBe(false)
  })
}
