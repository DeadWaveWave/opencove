import { afterEach, describe, expect, it, vi } from 'vitest'

const { getShellEnvironmentSnapshotMock } = vi.hoisted(() => ({
  getShellEnvironmentSnapshotMock: vi.fn(),
}))

vi.mock('../../../src/platform/os/ShellEnvironmentService', async importOriginal => {
  const original =
    await importOriginal<typeof import('../../../src/platform/os/ShellEnvironmentService')>()
  return {
    ...original,
    getShellEnvironmentSnapshot: getShellEnvironmentSnapshotMock,
  }
})

const ORIGINAL_ENV = { ...process.env }
const ORIGINAL_PLATFORM = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  })
}

async function importCommandEnvironmentService() {
  return await import('../../../src/platform/os/CommandEnvironmentService')
}

afterEach(async () => {
  process.env = { ...ORIGINAL_ENV }
  setPlatform(ORIGINAL_PLATFORM)
  const { disposeCommandEnvironmentService } = await importCommandEnvironmentService()
  disposeCommandEnvironmentService()
  vi.clearAllMocks()
  vi.resetModules()
})

describe('CommandEnvironmentService', () => {
  it('uses a sanitized shell snapshot for POSIX command execution by default', async () => {
    setPlatform('darwin')
    process.env.NODE_ENV = 'production'
    delete process.env.OPENCOVE_TRUST_PROCESS_ENV
    delete process.env.DISABLE_AUTO_UPDATE
    delete process.env.ZSH_TMUX_AUTOSTARTED
    delete process.env.ZSH_TMUX_AUTOSTART

    getShellEnvironmentSnapshotMock.mockResolvedValue({
      env: {
        PATH: '/shell/bin',
        LANG: 'en_US.UTF-8',
        DISABLE_AUTO_UPDATE: 'true',
        ZSH_TMUX_AUTOSTARTED: 'true',
        ZSH_TMUX_AUTOSTART: 'false',
      },
      shellPath: '/bin/zsh',
      source: 'default_shell',
      diagnostics: ['shell captured'],
    })

    const { getCommandEnvironmentSnapshot } = await importCommandEnvironmentService()
    const snapshot = await getCommandEnvironmentSnapshot()

    expect(snapshot).toEqual({
      env: {
        PATH: '/shell/bin',
        LANG: 'en_US.UTF-8',
      },
      shellPath: '/bin/zsh',
      source: 'shell_env',
      diagnostics: ['shell captured'],
    })
  })

  it('uses the current process environment when a launch marker requests it', async () => {
    setPlatform('darwin')
    process.env.NODE_ENV = 'production'
    process.env.OPENCOVE_TRUST_PROCESS_ENV = '1'
    process.env.PATH = '/process/bin'

    const { getCommandEnvironmentSnapshot } = await importCommandEnvironmentService()
    const snapshot = await getCommandEnvironmentSnapshot()

    expect(snapshot.source).toBe('process_env')
    expect(snapshot.env.PATH).toBe('/process/bin')
    expect(snapshot.diagnostics).toEqual([
      'Launch marker requested the current process environment for command execution.',
    ])
    expect(getShellEnvironmentSnapshotMock).not.toHaveBeenCalled()
  })
})
