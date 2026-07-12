import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getCommandExecutionEnvironmentMock, runCommandMock } = vi.hoisted(() => ({
  getCommandExecutionEnvironmentMock: vi.fn(),
  runCommandMock: vi.fn(),
}))

vi.mock('../../../src/platform/os/CommandEnvironmentService', () => ({
  getCommandExecutionEnvironment: getCommandExecutionEnvironmentMock,
}))

vi.mock('../../../src/platform/process/runCommand', () => ({
  runCommand: runCommandMock,
}))

describe('GitWorktreeService.shared', () => {
  beforeEach(() => {
    vi.resetModules()
    getCommandExecutionEnvironmentMock.mockReset()
    runCommandMock.mockReset()
  })

  it('runs git with the shared command execution environment', async () => {
    const env = {
      HOME: '/Users/tester',
      PATH: '/opt/homebrew/bin:/usr/bin:/bin',
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
    }
    getCommandExecutionEnvironmentMock.mockResolvedValue(env)
    runCommandMock.mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    })

    const { runGit } =
      await import('../../../src/contexts/worktree/infrastructure/git/GitWorktreeService.shared')

    const result = await runGit(['status', '--short'], '/repo', {
      intent: 'observation',
      timeoutMs: 1234,
    })

    expect(getCommandExecutionEnvironmentMock).toHaveBeenCalledWith({
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
    })
    expect(runCommandMock).toHaveBeenCalledWith('git', ['status', '--short'], '/repo', {
      timeoutMs: 1234,
      env,
    })
    expect(result).toEqual({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    })
  })

  it('runs mutations with required git locks and without a destructive timeout', async () => {
    const env = {
      HOME: '/Users/tester',
      PATH: '/opt/homebrew/bin:/usr/bin:/bin',
      GIT_TERMINAL_PROMPT: '0',
    }
    getCommandExecutionEnvironmentMock.mockResolvedValue(env)
    runCommandMock.mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
    })

    const { runGit } =
      await import('../../../src/contexts/worktree/infrastructure/git/GitWorktreeService.shared')

    await runGit(['worktree', 'add', '/repo/worktree', 'HEAD'], '/repo', {
      intent: 'mutation',
    })

    expect(getCommandExecutionEnvironmentMock).toHaveBeenCalledWith({
      GIT_TERMINAL_PROMPT: '0',
    })
    expect(runCommandMock).toHaveBeenCalledWith(
      'git',
      ['worktree', 'add', '/repo/worktree', 'HEAD'],
      '/repo',
      {
        timeoutMs: null,
        env,
      },
    )
  })

  it('maps missing git to a worktree git unavailable error', async () => {
    getCommandExecutionEnvironmentMock.mockResolvedValue({
      PATH: '/opt/homebrew/bin:/usr/bin:/bin',
      GIT_TERMINAL_PROMPT: '0',
    })
    runCommandMock.mockRejectedValue(
      Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }),
    )

    const { runGit } =
      await import('../../../src/contexts/worktree/infrastructure/git/GitWorktreeService.shared')

    await expect(
      runGit(['status', '--short'], '/repo', { intent: 'observation' }),
    ).rejects.toMatchObject({
      code: 'worktree.git_unavailable',
    })
  })
})
