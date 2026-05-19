import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn<typeof import('node:child_process').spawn>(),
}))

const { getCommandEnvironmentSnapshotMock } = vi.hoisted(() => ({
  getCommandEnvironmentSnapshotMock: vi.fn(),
}))

const { locateExecutableMock } = vi.hoisted(() => ({
  locateExecutableMock: vi.fn(),
}))

const { resolveAgentProviderAvailabilityMock, disposeAgentExecutableResolverMock } = vi.hoisted(
  () => ({
    resolveAgentProviderAvailabilityMock: vi.fn(),
    disposeAgentExecutableResolverMock: vi.fn(),
  }),
)

const { resolveAgentCliInvocationMock } = vi.hoisted(() => ({
  resolveAgentCliInvocationMock: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  default: { spawn: spawnMock },
}))

vi.mock('../../../src/platform/os/CommandEnvironmentService', () => ({
  getCommandEnvironmentSnapshot: getCommandEnvironmentSnapshotMock,
}))

vi.mock('../../../src/platform/os/CliEnvironment', () => ({
  buildAdditionalPathSegments: vi.fn(() => ['/Users/tester/.npm-global/bin']),
}))

vi.mock('../../../src/platform/os/HomeDirectory', () => ({
  resolveHomeDirectory: vi.fn(() => '/Users/tester'),
}))

vi.mock('../../../src/platform/process/ExecutableLocator', () => ({
  locateExecutable: locateExecutableMock,
}))

vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentExecutableResolver', () => ({
  disposeAgentExecutableResolver: disposeAgentExecutableResolverMock,
  resolveAgentProviderAvailability: resolveAgentProviderAvailabilityMock,
}))

vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentCliInvocation', () => ({
  resolveAgentCliInvocation: resolveAgentCliInvocationMock,
}))

type MockChildProcess = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

function createMockChildProcess(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn(() => true)
  return child
}

async function importInstaller() {
  return await import('../../../src/contexts/agent/infrastructure/cli/AgentProviderInstaller')
}

beforeEach(() => {
  getCommandEnvironmentSnapshotMock.mockResolvedValue({
    env: { PATH: '/shell/bin' },
    shellPath: '/bin/zsh',
    source: 'shell_env',
    diagnostics: ['shell env'],
  })
  locateExecutableMock.mockResolvedValue({
    toolId: 'npm',
    command: 'npm',
    executablePath: '/usr/local/bin/npm',
    source: 'shell_env_path',
    status: 'resolved',
    diagnostics: ['Resolved npm.'],
  })
  resolveAgentCliInvocationMock.mockResolvedValue({
    command: '/usr/local/bin/npm',
    args: ['install', '--global', '@openai/codex'],
  })
  resolveAgentProviderAvailabilityMock.mockResolvedValue({
    provider: 'codex',
    command: 'codex',
    status: 'available',
    executablePath: '/Users/tester/.npm-global/bin/codex',
    source: 'shell_env_path',
    diagnostics: ['Resolved codex.'],
  })
})

afterEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  vi.useRealTimers()
})

describe('AgentProviderInstaller', () => {
  it('installs the provider npm package and refreshes availability', async () => {
    spawnMock.mockImplementation(() => {
      const child = createMockChildProcess()
      queueMicrotask(() => {
        child.stdout.emit('data', 'installed\n')
        child.emit('close', 0)
      })
      return child as ReturnType<typeof spawnMock>
    })

    const { installAgentProvider } = await importInstaller()

    await expect(installAgentProvider('codex')).resolves.toMatchObject({
      provider: 'codex',
      packageName: '@openai/codex',
      stdout: 'installed',
      availability: {
        status: 'available',
        executablePath: '/Users/tester/.npm-global/bin/codex',
      },
    })
    expect(locateExecutableMock).toHaveBeenCalledWith({
      toolId: 'npm',
      command: 'npm',
      fallbackDirectories: ['/Users/tester/.npm-global/bin'],
    })
    expect(resolveAgentCliInvocationMock).toHaveBeenCalledWith({
      command: '/usr/local/bin/npm',
      args: ['install', '--global', '@openai/codex'],
    })
    expect(spawnMock).toHaveBeenCalledWith(
      '/usr/local/bin/npm',
      ['install', '--global', '@openai/codex'],
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }),
    )
    expect(disposeAgentExecutableResolverMock).toHaveBeenCalledTimes(1)
    expect(resolveAgentProviderAvailabilityMock).toHaveBeenCalledWith({ provider: 'codex' })
  })

  it('fails when npm cannot be resolved', async () => {
    locateExecutableMock.mockResolvedValue({
      toolId: 'npm',
      command: 'npm',
      executablePath: null,
      source: null,
      status: 'not_found',
      diagnostics: ['Unable to resolve npm.'],
    })

    const { installAgentProvider } = await importInstaller()

    await expect(installAgentProvider('gemini')).rejects.toThrow('This feature is unavailable.')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('fails when install completes but the CLI is still unavailable', async () => {
    spawnMock.mockImplementation(() => {
      const child = createMockChildProcess()
      queueMicrotask(() => {
        child.emit('close', 0)
      })
      return child as ReturnType<typeof spawnMock>
    })
    resolveAgentCliInvocationMock.mockResolvedValue({
      command: '/usr/local/bin/npm',
      args: ['install', '--global', '@google/gemini-cli'],
    })
    resolveAgentProviderAvailabilityMock.mockResolvedValue({
      provider: 'gemini',
      command: 'gemini',
      status: 'unavailable',
      executablePath: null,
      source: null,
      diagnostics: ['Unable to resolve gemini.'],
    })

    const { installAgentProvider } = await importInstaller()

    await expect(installAgentProvider('gemini')).rejects.toThrow('This feature is unavailable.')
    expect(disposeAgentExecutableResolverMock).toHaveBeenCalledTimes(1)
  })
})
