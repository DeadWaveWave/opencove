import { afterEach, describe, expect, it, vi } from 'vitest'

const { locateExecutableMock } = vi.hoisted(() => ({
  locateExecutableMock: vi.fn(),
}))

const { resolveAgentCliInvocationMock } = vi.hoisted(() => ({
  resolveAgentCliInvocationMock: vi.fn(),
}))

vi.mock('../../../src/platform/process/ExecutableLocator', () => ({
  locateExecutable: locateExecutableMock,
}))

vi.mock('../../../src/platform/os/CliEnvironment', () => ({
  buildAdditionalPathSegments: vi.fn(() => ['/Users/tester/.npm-global/bin']),
}))

vi.mock('../../../src/platform/os/HomeDirectory', () => ({
  resolveHomeDirectory: vi.fn(() => '/Users/tester'),
}))

vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentCliInvocation', () => ({
  resolveAgentCliInvocation: resolveAgentCliInvocationMock,
}))

async function importAgentExecutableResolver() {
  return await import('../../../src/contexts/agent/infrastructure/cli/AgentExecutableResolver')
}

afterEach(async () => {
  const { disposeAgentExecutableResolver } = await importAgentExecutableResolver()
  disposeAgentExecutableResolver()
  vi.clearAllMocks()
  vi.resetModules()
})

describe('AgentExecutableResolver', () => {
  it('maps invalid overrides to a misconfigured availability status', async () => {
    locateExecutableMock.mockResolvedValue({
      toolId: 'codex',
      command: 'codex',
      executablePath: null,
      source: null,
      status: 'invalid_override',
      diagnostics: ['Configured override was not executable: /broken/codex'],
    })

    const { resolveAgentProviderAvailability } = await importAgentExecutableResolver()
    const availability = await resolveAgentProviderAvailability({
      provider: 'codex',
      overridePath: '/broken/codex',
    })

    expect(locateExecutableMock).toHaveBeenCalledWith({
      toolId: 'codex',
      command: 'codex',
      overridePath: '/broken/codex',
      fallbackDirectories: ['/Users/tester/.npm-global/bin'],
    })
    expect(availability).toEqual({
      provider: 'codex',
      command: 'codex',
      status: 'misconfigured',
      executablePath: null,
      source: null,
      diagnostics: ['Configured override was not executable: /broken/codex'],
    })
  })

  it('caches resolution results by provider and override path', async () => {
    locateExecutableMock.mockResolvedValue({
      toolId: 'codex',
      command: 'codex',
      executablePath: '/opt/codex/bin/codex',
      source: 'override',
      status: 'resolved',
      diagnostics: ['Resolved codex from explicit override.'],
    })

    const { resolveAgentExecutable, disposeAgentExecutableResolver } =
      await importAgentExecutableResolver()

    await resolveAgentExecutable({ provider: 'codex', overridePath: '/opt/codex/bin/codex' })
    await resolveAgentExecutable({ provider: 'codex', overridePath: '/opt/codex/bin/codex' })

    expect(locateExecutableMock).toHaveBeenCalledTimes(1)

    disposeAgentExecutableResolver()

    await resolveAgentExecutable({ provider: 'codex', overridePath: '/opt/codex/bin/codex' })
    expect(locateExecutableMock).toHaveBeenCalledTimes(2)
  })

  it('resolves the final CLI invocation from the resolved executable path', async () => {
    locateExecutableMock.mockResolvedValue({
      toolId: 'codex',
      command: 'codex',
      executablePath: 'C:\\Users\\tester\\AppData\\Roaming\\npm\\codex.cmd',
      source: 'override',
      status: 'resolved',
      diagnostics: ['Resolved codex from explicit override.'],
    })
    resolveAgentCliInvocationMock.mockResolvedValue({
      command: 'cmd.exe',
      args: ['/d', '/c', 'C:\\Users\\tester\\AppData\\Roaming\\npm\\codex.cmd', 'app-server'],
    })

    const { resolveAgentExecutableInvocation } = await importAgentExecutableResolver()
    const result = await resolveAgentExecutableInvocation({
      provider: 'codex',
      args: ['app-server'],
      overridePath: 'C:\\Users\\tester\\AppData\\Roaming\\npm\\codex.cmd',
    })

    expect(resolveAgentCliInvocationMock).toHaveBeenCalledWith({
      command: 'C:\\Users\\tester\\AppData\\Roaming\\npm\\codex.cmd',
      args: ['app-server'],
    })
    expect(result.invocation).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/c', 'C:\\Users\\tester\\AppData\\Roaming\\npm\\codex.cmd', 'app-server'],
    })
    expect(result.executable.executablePath).toBe(
      'C:\\Users\\tester\\AppData\\Roaming\\npm\\codex.cmd',
    )
  })
})
