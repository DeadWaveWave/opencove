import { describe, expect, it } from 'vitest'
import { TerminalProfileResolver } from '../../../src/platform/terminal/TerminalProfileResolver'

describe('TerminalProfileResolver', () => {
  it('returns no terminal profiles outside Windows', async () => {
    const resolver = new TerminalProfileResolver({
      platform: 'darwin',
    })

    await expect(resolver.listProfiles()).resolves.toEqual({
      profiles: [],
      defaultProfileId: null,
    })
  })

  it('lists detected Windows profiles and keeps PowerShell as the stable default', async () => {
    const resolver = new TerminalProfileResolver({
      platform: 'win32',
      locateWindowsCommands: async commands => {
        if (commands.includes('powershell.exe')) {
          return ['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe']
        }

        if (commands.includes('pwsh.exe')) {
          return ['C:\\Program Files\\PowerShell\\7\\pwsh.exe']
        }

        if (commands.includes('bash.exe')) {
          return ['C:\\Program Files\\Git\\bin\\bash.exe']
        }

        return []
      },
      listWslDistros: async () => ['Ubuntu'],
    })

    const result = await resolver.listProfiles()

    expect(result.defaultProfileId).toBe('powershell')
    expect(result.profiles).toEqual([
      { id: 'powershell', label: 'PowerShell', runtimeKind: 'windows' },
      { id: 'pwsh', label: 'PowerShell 7', runtimeKind: 'windows' },
      {
        id: 'bash:c:\\program files\\git\\bin\\bash.exe',
        label: 'Bash (Git Bash)',
        runtimeKind: 'windows',
      },
      { id: 'wsl:Ubuntu', label: 'WSL (Ubuntu)', runtimeKind: 'wsl' },
    ])
  })

  it('filters Windows bash shims and internal Docker WSL distros from the profile list', async () => {
    const resolver = new TerminalProfileResolver({
      platform: 'win32',
      locateWindowsCommands: async commands => {
        if (commands.includes('powershell.exe')) {
          return ['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe']
        }

        if (commands.includes('bash.exe')) {
          return [
            'C:\\Windows\\System32\\bash.exe',
            'C:\\Users\\tester\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe',
            'C:\\Program Files\\Git\\bin\\bash.exe',
          ]
        }

        return []
      },
      listWslDistros: async () => [
        'Ubuntu',
        'docker-desktop',
        'docker-desktop-data',
        'Ubuntu-20.04',
      ],
    })

    const result = await resolver.listProfiles()

    expect(result.profiles).toEqual([
      { id: 'powershell', label: 'PowerShell', runtimeKind: 'windows' },
      {
        id: 'bash:c:\\program files\\git\\bin\\bash.exe',
        label: 'Bash (Git Bash)',
        runtimeKind: 'windows',
      },
      { id: 'wsl:Ubuntu', label: 'WSL (Ubuntu)', runtimeKind: 'wsl' },
      { id: 'wsl:Ubuntu-20.04', label: 'WSL (Ubuntu-20.04)', runtimeKind: 'wsl' },
    ])
  })

  it('resolves WSL sessions with linux cwd translation and Windows host cwd fallback', async () => {
    const resolver = new TerminalProfileResolver({
      platform: 'win32',
      env: () => ({ PATH: 'C:\\Windows\\System32' }),
      homeDir: () => 'C:\\Users\\tester',
      locateWindowsCommands: async () => [
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ],
      listWslDistros: async () => ['Ubuntu'],
    })

    const result = await resolver.resolveTerminalSpawn({
      cwd: '\\\\wsl$\\Ubuntu\\home\\tester\\repo',
      profileId: 'wsl:Ubuntu',
      cols: 80,
      rows: 24,
    })

    expect(result).toMatchObject({
      command: 'wsl.exe',
      args: ['--distribution', 'Ubuntu', '--cd', '/home/tester/repo'],
      cwd: 'C:\\Users\\tester',
      profileId: 'wsl:Ubuntu',
      runtimeKind: 'wsl',
    })
  })

  it('resolves Windows bash sessions with CHERE_INVOKING to preserve cwd', async () => {
    const resolver = new TerminalProfileResolver({
      platform: 'win32',
      env: () => ({ PATH: 'C:\\Windows\\System32', FOO: 'bar' }),
      locateWindowsCommands: async commands => {
        if (commands.includes('bash.exe')) {
          return ['D:\\Git\\bin\\bash.exe']
        }

        return ['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe']
      },
      listWslDistros: async () => [],
    })

    const result = await resolver.resolveTerminalSpawn({
      cwd: 'D:\\repo',
      profileId: 'bash:d:\\git\\bin\\bash.exe',
      cols: 80,
      rows: 24,
    })

    expect(result.command).toBe('D:\\Git\\bin\\bash.exe')
    expect(result.cwd).toBe('D:\\repo')
    expect(result.runtimeKind).toBe('windows')
    expect(result.env.CHERE_INVOKING).toBe('1')
    expect(result.env.FOO).toBe('bar')
  })

  it('adds terminal capability env for Windows PowerShell sessions', async () => {
    const resolver = new TerminalProfileResolver({
      platform: 'win32',
      env: () => ({ PATH: 'C:\\Windows\\System32' }),
      locateWindowsCommands: async () => [
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ],
      listWslDistros: async () => [],
    })

    const result = await resolver.resolveTerminalSpawn({
      cwd: 'C:\\repo',
      profileId: 'powershell',
      cols: 80,
      rows: 24,
    })

    expect(result.env.TERM).toBe('xterm-256color')
    expect(result.env.COLORTERM).toBe('truecolor')
    expect(result.env.TERM_PROGRAM).toBe('OpenCove')
  })

  it('matches Windows profile ids case-insensitively during restore', async () => {
    const resolver = new TerminalProfileResolver({
      platform: 'win32',
      locateWindowsCommands: async commands => {
        if (commands.includes('powershell.exe')) {
          return ['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe']
        }

        return []
      },
      listWslDistros: async () => ['Ubuntu'],
    })

    const result = await resolver.resolveTerminalSpawn({
      cwd: 'C:\\repo',
      profileId: 'wsl:ubuntu',
      cols: 80,
      rows: 24,
    })

    expect(result).toMatchObject({
      command: 'wsl.exe',
      args: ['--distribution', 'Ubuntu', '--cd', '/mnt/c/repo'],
      profileId: 'wsl:Ubuntu',
      runtimeKind: 'wsl',
    })
  })

  it('resolves agent commands through the selected WSL profile', async () => {
    const resolver = new TerminalProfileResolver({
      platform: 'win32',
      env: () => ({ PATH: 'C:\\Windows\\System32' }),
      homeDir: () => 'C:\\Users\\tester',
      locateWindowsCommands: async () => [
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ],
      listWslDistros: async () => ['Ubuntu'],
    })

    const result = await resolver.resolveCommandSpawn({
      cwd: 'C:\\repo',
      profileId: 'wsl:Ubuntu',
      command: 'codex',
      args: ['resume', 'session-1'],
      env: {
        OPENCOVE_OPENCODE_SERVER_PORT: '5173',
      },
    })

    expect(result).toMatchObject({
      command: 'wsl.exe',
      args: [
        '--distribution',
        'Ubuntu',
        '--cd',
        '/mnt/c/repo',
        'env',
        'OPENCOVE_OPENCODE_SERVER_PORT=5173',
        'codex',
        'resume',
        'session-1',
      ],
      cwd: 'C:\\repo',
      profileId: 'wsl:Ubuntu',
      runtimeKind: 'wsl',
    })
  })

  it('resolves agent commands through Git Bash with login shell exec semantics', async () => {
    const resolver = new TerminalProfileResolver({
      platform: 'win32',
      env: () => ({ PATH: 'C:\\Windows\\System32', FOO: 'bar' }),
      locateWindowsCommands: async commands => {
        if (commands.includes('bash.exe')) {
          return ['D:\\Git\\bin\\bash.exe']
        }

        return ['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe']
      },
      listWslDistros: async () => [],
    })

    const result = await resolver.resolveCommandSpawn({
      cwd: 'D:\\repo',
      profileId: 'bash:d:\\git\\bin\\bash.exe',
      command: 'codex',
      args: ['resume', 'session-1'],
    })

    expect(result).toMatchObject({
      command: 'D:\\Git\\bin\\bash.exe',
      args: ['--login', '-c', 'exec "$@"', 'bash', 'codex', 'resume', 'session-1'],
      cwd: 'D:\\repo',
      profileId: 'bash:d:\\git\\bin\\bash.exe',
      runtimeKind: 'windows',
    })
    expect(result.env.CHERE_INVOKING).toBe('1')
    expect(result.env.FOO).toBe('bar')
  })
})
