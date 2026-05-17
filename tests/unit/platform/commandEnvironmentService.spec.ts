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
        ELECTRON_RUN_AS_NODE: '1',
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
    process.env.ELECTRON_RUN_AS_NODE = '1'

    const { getCommandEnvironmentSnapshot } = await importCommandEnvironmentService()
    const snapshot = await getCommandEnvironmentSnapshot()

    expect(snapshot.source).toBe('process_env')
    expect(snapshot.env.PATH).toBe('/process/bin')
    expect(snapshot.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(snapshot.diagnostics).toEqual([
      'Launch marker requested the current process environment for command execution.',
    ])
    expect(getShellEnvironmentSnapshotMock).not.toHaveBeenCalled()
  })

  it('prepends explicit command PATH without dropping the base command environment PATH', async () => {
    setPlatform('linux')
    process.env.NODE_ENV = 'production'
    delete process.env.OPENCOVE_TRUST_PROCESS_ENV

    getShellEnvironmentSnapshotMock.mockResolvedValue({
      env: {
        PATH: '/usr/bin:/bin:/root/.local/bin',
      },
      shellPath: '/bin/bash',
      source: 'default_shell',
      diagnostics: [],
    })

    const { getCommandExecutionEnvironment } = await importCommandEnvironmentService()
    const env = await getCommandExecutionEnvironment({ PATH: '/custom/bin' })

    expect(env.PATH?.split(':')).toEqual(['/custom/bin', '/usr/bin', '/bin', '/root/.local/bin'])
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
    process.env.WINDIR = 'C:\\Windows'
    process.env.SystemRoot = 'C:\\Windows'
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
      'C:\\Windows\\System32\\OpenSSH',
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

  it('preserves a Windows process Path key when normalizing command PATH', async () => {
    setPlatform('win32')
    process.env = {
      NODE_ENV: 'production',
      Path: 'E:\\node-v22.17.0-win-x64\\node_global',
      USERPROFILE: 'C:\\Users\\tester',
    } as NodeJS.ProcessEnv

    const { getCommandEnvironmentSnapshot } = await importCommandEnvironmentService()
    const snapshot = await getCommandEnvironmentSnapshot()

    expect(snapshot.source).toBe('process_env')
    expect(snapshot.env.PATH?.split(';')[0]).toBe('E:\\node-v22.17.0-win-x64\\node_global')
    expect(snapshot.env.Path).toBeUndefined()
    expect(snapshot.diagnostics).toContain(
      'Appended stable Windows command fallback directories to the current process PATH.',
    )
    expect(snapshot.diagnostics).toContain('Canonicalized Windows process Path key to PATH.')
    expect(getShellEnvironmentSnapshotMock).not.toHaveBeenCalled()
  })

  it('canonicalizes a Windows process Path key even when no fallback segments are appended', async () => {
    setPlatform('win32')
    process.env = {
      NODE_ENV: 'production',
      Path: [
        'C:\\Windows\\System32',
        'C:\\Windows\\System32\\OpenSSH',
        'C:\\Users\\tester\\AppData\\Roaming\\npm',
        'C:\\Users\\tester\\AppData\\Local\\pnpm',
        'C:\\Users\\tester\\AppData\\Local\\Volta\\bin',
        'C:\\Users\\tester\\scoop\\shims',
        'C:\\ProgramData\\scoop\\shims',
        'C:\\Program Files\\nodejs',
        'C:\\Program Files\\nodejs\\node_global',
      ].join(';'),
      USERPROFILE: 'C:\\Users\\tester',
      APPDATA: 'C:\\Users\\tester\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local',
      SCOOP: 'C:\\Users\\tester\\scoop',
      ProgramData: 'C:\\ProgramData',
      ProgramFiles: 'C:\\Program Files',
    } as NodeJS.ProcessEnv

    const { getCommandEnvironmentSnapshot } = await importCommandEnvironmentService()
    const snapshot = await getCommandEnvironmentSnapshot()

    expect(snapshot.source).toBe('process_env')
    expect(snapshot.env.PATH?.split(';')[0]).toBe('C:\\Windows\\System32')
    expect(snapshot.env.Path).toBeUndefined()
    expect(snapshot.diagnostics).toEqual([
      'Windows uses the current process environment for command execution.',
      'Canonicalized Windows process Path key to PATH.',
    ])
    expect(getShellEnvironmentSnapshotMock).not.toHaveBeenCalled()
  })
})
