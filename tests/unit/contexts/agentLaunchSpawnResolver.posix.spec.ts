import { afterEach, describe, expect, it, vi } from 'vitest'

const { getCommandExecutionEnvironmentMock } = vi.hoisted(() => ({
  getCommandExecutionEnvironmentMock: vi.fn(),
}))

vi.mock('../../../src/platform/os/CommandEnvironmentService', () => ({
  getCommandExecutionEnvironment: getCommandExecutionEnvironmentMock,
}))

const originalPlatform = process.platform

afterEach(() => {
  Object.defineProperty(process, 'platform', {
    value: originalPlatform,
    configurable: true,
  })
  vi.clearAllMocks()
  vi.resetModules()
})

describe('AgentLaunchSpawnResolver on POSIX', () => {
  it('preserves the hydrated command PATH when launch env supplies its own PATH', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      configurable: true,
    })
    getCommandExecutionEnvironmentMock.mockResolvedValue({
      PATH: '/tmp/only:/usr/bin:/bin',
      CUSTOM_FLAG: '1',
    })

    const { resolveAgentLaunchSpawn } =
      await import('../../../src/contexts/agent/infrastructure/cli/AgentLaunchSpawnResolver')

    const result = await resolveAgentLaunchSpawn({
      cwd: '/repo',
      profileId: null,
      command: 'codex',
      args: ['--model', 'gpt-5.2-codex'],
      env: { PATH: '/tmp/only' },
    })

    expect(getCommandExecutionEnvironmentMock).toHaveBeenCalledWith({ PATH: '/tmp/only' })
    expect(result).toMatchObject({
      command: 'codex',
      args: ['--model', 'gpt-5.2-codex'],
      cwd: '/repo',
      profileId: null,
      runtimeKind: 'posix',
    })
    expect(result.env.PATH).toBe('/tmp/only:/usr/bin:/bin')
    expect(result.env.CUSTOM_FLAG).toBe('1')
  })
})
