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

  it('enriches Windows process PATH with stable fallback directories for wrapper runtimes', async () => {
    setPlatform('win32')
    process.env.NODE_ENV = 'production'
    process.env.PATH = 'C:\\Windows\\System32'
    delete process.env.HOME
    process.env.USERPROFILE = 'C:\\Users\\tester'
    delete process.env.PNPM_HOME
    process.env.SCOOP = 'C:\\Users\\tester\\scoop'
    process.env.ProgramFiles = 'C:\\Program Files'
    delete process.env['ProgramFiles(x86)']
    process.env.ProgramData = 'C:\\ProgramData'
    process.env.APPDATA = 'C:\\Users\\tester\\AppData\\Roaming'
    process.env.LOCALAPPDATA = 'C:\\Users\\tester\\AppData\\Local'
    process.env.NVM_SYMLINK = 'C:\\nvm4w\\nodejs'
    delete process.env.ChocolateyInstall

    const { getCommandEnvironmentSnapshot } = await importCommandEnvironmentService()
    const snapshot = await getCommandEnvironmentSnapshot()

    expect(snapshot.source).toBe('process_env')
    expect(snapshot.env.PATH?.split(';')).toEqual([
      'C:\\Windows\\System32',
      'C:\\nvm4w\\nodejs',
      'C:\\Users\\tester\\AppData\\Roaming\\npm',
      'C:\\Users\\tester\\AppData\\Local\\pnpm',
      'C:\\Users\\tester\\AppData\\Local\\Volta\\bin',
      'C:\\Users\\tester\\scoop\\shims',
      'C:\\ProgramData\\scoop\\shims',
      'C:\\Program Files\\nodejs',
      'C:\\Program Files\\nodejs\\node_global',
    ])
    expect(snapshot.diagnostics).toEqual([
      'Windows uses the current process environment for command execution.',
      'Appended stable Windows command fallback directories to the current process PATH.',
    ])
    expect(getShellEnvironmentSnapshotMock).not.toHaveBeenCalled()
  })
})
