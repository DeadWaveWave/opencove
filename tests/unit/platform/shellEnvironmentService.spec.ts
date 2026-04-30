import { afterEach, describe, expect, it, vi } from 'vitest'

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn<typeof import('node:child_process').execFile>(),
}))

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
  default: {
    execFile: execFileMock,
  },
}))

const ORIGINAL_ENV = { ...process.env }
const ORIGINAL_PLATFORM = process.platform
const SHELL_ENV_MARKER = '__OPENCOVE_SHELL_ENV_MARKER__'

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  })
}

async function importShellEnvironmentService() {
  return await import('../../../src/platform/os/ShellEnvironmentService')
}

afterEach(async () => {
  process.env = { ...ORIGINAL_ENV }
  setPlatform(ORIGINAL_PLATFORM)
  const { disposeShellEnvironmentService } = await importShellEnvironmentService()
  disposeShellEnvironmentService()
  vi.clearAllMocks()
  vi.resetModules()
})

describe('ShellEnvironmentService', () => {
  it('captures environment variables from the default shell', async () => {
    setPlatform('darwin')
    process.env.SHELL = '/bin/zsh'

    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback?.(
        null,
        `${SHELL_ENV_MARKER}PATH=/shell/bin\nLANG=en_US.UTF-8\n${SHELL_ENV_MARKER}`,
        '',
      )
      return {} as ReturnType<typeof execFileMock>
    })

    const { getShellEnvironmentSnapshot } = await importShellEnvironmentService()
    const snapshot = await getShellEnvironmentSnapshot()

    expect(execFileMock).toHaveBeenCalledTimes(2)
    expect(snapshot.shellPath).toBe('/bin/zsh')
    expect(snapshot.source).toBe('default_shell')
    expect(snapshot.env.PATH).toBe('/shell/bin')
    expect(snapshot.env.LANG).toBe('en_US.UTF-8')
    expect(snapshot.diagnostics).toEqual([])
  })

  it('falls back to a secondary shell when the primary shell capture fails', async () => {
    setPlatform('darwin')
    process.env.SHELL = '/bin/zsh'

    execFileMock.mockImplementation((file, _args, _options, callback) => {
      if (file === '/bin/zsh') {
        callback?.(new Error('zsh unavailable'), '', 'zsh: command not found')
        return {} as ReturnType<typeof execFileMock>
      }

      callback?.(
        null,
        `${SHELL_ENV_MARKER}PATH=/fallback/bin\nLC_ALL=en_US.UTF-8\n${SHELL_ENV_MARKER}`,
        '',
      )
      return {} as ReturnType<typeof execFileMock>
    })

    const { getShellEnvironmentSnapshot } = await importShellEnvironmentService()
    const snapshot = await getShellEnvironmentSnapshot()

    expect(execFileMock).toHaveBeenCalledTimes(2)
    expect(snapshot.shellPath).toBe('/bin/bash')
    expect(snapshot.source).toBe('fallback_shell')
    expect(snapshot.env.PATH).toBe('/fallback/bin')
    expect(snapshot.diagnostics).toEqual([
      'Shell env capture failed for /bin/zsh: zsh unavailable',
      'stderr: zsh: command not found',
    ])
  })
})
