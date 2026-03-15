import { afterEach, describe, expect, it, vi } from 'vitest'

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn<typeof import('node:child_process').execFile>(),
}))

vi.mock('node:child_process', () => {
  return {
    execFile: execFileMock,
    default: {
      execFile: execFileMock,
    },
  }
})

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  })
}

describe('resolveAgentCliInvocation', () => {
  const originalPlatform = process.platform

  afterEach(() => {
    setPlatform(originalPlatform)
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('keeps non-Windows invocations unchanged', async () => {
    setPlatform('darwin')

    const { resolveAgentCliInvocation } =
      await import('../../../src/contexts/agent/infrastructure/cli/AgentCliInvocation')

    await expect(
      resolveAgentCliInvocation({
        command: 'codex',
        args: ['--model', 'gpt-5.2-codex'],
      }),
    ).resolves.toEqual({
      command: 'codex',
      args: ['--model', 'gpt-5.2-codex'],
    })

    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('wraps Windows batch shims through cmd.exe', async () => {
    setPlatform('win32')
    execFileMock.mockImplementation((_file, _args, options, callback) => {
      const cb = typeof options === 'function' ? options : callback
      cb?.(null, 'C:\\Users\\deadwave\\AppData\\Roaming\\npm\\codex.cmd\r\n', '')
      return {} as ReturnType<typeof execFileMock>
    })

    const { resolveAgentCliInvocation } =
      await import('../../../src/contexts/agent/infrastructure/cli/AgentCliInvocation')

    await expect(
      resolveAgentCliInvocation({
        command: 'codex',
        args: ['resume', 'session-1'],
      }),
    ).resolves.toEqual({
      command: 'cmd.exe',
      args: [
        '/d',
        '/c',
        'C:\\Users\\deadwave\\AppData\\Roaming\\npm\\codex.cmd',
        'resume',
        'session-1',
      ],
    })
  })

  it('uses Windows direct executables without a shell wrapper', async () => {
    setPlatform('win32')
    execFileMock.mockImplementation((_file, _args, options, callback) => {
      const cb = typeof options === 'function' ? options : callback
      cb?.(null, 'C:\\tools\\codex.exe\r\n', '')
      return {} as ReturnType<typeof execFileMock>
    })

    const { resolveAgentCliInvocation } =
      await import('../../../src/contexts/agent/infrastructure/cli/AgentCliInvocation')

    await expect(
      resolveAgentCliInvocation({
        command: 'codex',
        args: ['app-server'],
      }),
    ).resolves.toEqual({
      command: 'C:\\tools\\codex.exe',
      args: ['app-server'],
    })
  })

  it('falls back to the npm .cmd shim when Windows resolution probe fails', async () => {
    setPlatform('win32')
    execFileMock.mockImplementation((_file, _args, options, callback) => {
      const cb = typeof options === 'function' ? options : callback
      cb?.(new Error('not found'))
      return {} as ReturnType<typeof execFileMock>
    })

    const { resolveAgentCliInvocation } =
      await import('../../../src/contexts/agent/infrastructure/cli/AgentCliInvocation')

    await expect(
      resolveAgentCliInvocation({
        command: 'claude',
        args: ['--continue'],
      }),
    ).resolves.toEqual({
      command: 'cmd.exe',
      args: ['/d', '/c', 'claude.cmd', '--continue'],
    })
  })
})
