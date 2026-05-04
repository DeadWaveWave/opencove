import { describe, expect, it } from 'vitest'
import {
  buildAdditionalPathSegments,
  computeHydratedCliPath,
  computeHydratedLocaleEnv,
} from '../../../src/platform/os/CliEnvironment'

describe('computeHydratedCliPath', () => {
  it('keeps PATH unchanged when app is not packaged', () => {
    const path = computeHydratedCliPath({
      isPackaged: false,
      platform: 'darwin',
      currentPath: '/usr/bin:/bin',
      homeDir: '/Users/tester',
      shellPathFromLogin: '/Users/tester/.local/bin:/opt/homebrew/bin',
    })

    expect(path).toBe('/usr/bin:/bin')
  })

  it('hydrates packaged macOS PATH with login shell and fallback segments', () => {
    const path = computeHydratedCliPath({
      isPackaged: true,
      platform: 'darwin',
      currentPath: '/usr/bin:/bin:/opt/homebrew/bin',
      homeDir: '/Users/tester',
      shellPathFromLogin: '/Users/tester/.local/bin:/usr/local/bin:/usr/bin',
    })

    expect(path.split(':')).toEqual([
      '/usr/bin',
      '/bin',
      '/opt/homebrew/bin',
      '/Users/tester/.local/bin',
      '/usr/local/bin',
      '/Users/tester/bin',
      '/Users/tester/.npm-global/bin',
      '/usr/sbin',
      '/sbin',
    ])
  })

  it('adds npm global bin as a fallback when the login shell omits it', () => {
    const path = computeHydratedCliPath({
      isPackaged: true,
      platform: 'darwin',
      currentPath: '/usr/bin:/bin',
      homeDir: '/Users/tester',
      shellPathFromLogin: '',
    })

    expect(path.split(':')).toContain('/Users/tester/.npm-global/bin')
  })

  it('uses semicolon delimiter for windows and avoids posix-only fallback segments', () => {
    const path = computeHydratedCliPath({
      isPackaged: true,
      platform: 'win32',
      currentPath: 'C:\\Windows\\System32;C:\\Tools',
      homeDir: 'C:\\Users\\tester',
      shellPathFromLogin: 'C:\\Tools;D:\\bin',
      env: {
        APPDATA: 'C:\\Users\\tester\\AppData\\Roaming',
        LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local',
      },
    })

    expect(path.split(';')).toEqual([
      'C:\\Windows\\System32',
      'C:\\Tools',
      'D:\\bin',
      'C:\\Users\\tester\\AppData\\Roaming\\npm',
      'C:\\Users\\tester\\AppData\\Local\\pnpm',
      'C:\\Users\\tester\\AppData\\Local\\Volta\\bin',
      'C:\\Users\\tester\\scoop\\shims',
    ])
    expect(path.split(';')).not.toContain('/Users/tester/.npm-global/bin')
  })
})

describe('buildAdditionalPathSegments', () => {
  it('adds common Windows node package manager shim directories', () => {
    expect(
      buildAdditionalPathSegments('win32', 'C:\\Users\\tester', {
        APPDATA: 'C:\\Users\\tester\\AppData\\Roaming',
        LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local',
        NVM_SYMLINK: 'C:\\nvm4w\\nodejs',
        PNPM_HOME: 'C:\\Users\\tester\\AppData\\Local\\pnpm',
        ChocolateyInstall: 'C:\\ProgramData\\chocolatey',
        ProgramFiles: 'C:\\Program Files',
        ProgramData: 'C:\\ProgramData',
      }),
    ).toEqual([
      'C:\\nvm4w\\nodejs',
      'C:\\Users\\tester\\AppData\\Local\\pnpm',
      'C:\\Users\\tester\\AppData\\Roaming\\npm',
      'C:\\Users\\tester\\AppData\\Local\\Volta\\bin',
      'C:\\Users\\tester\\scoop\\shims',
      'C:\\ProgramData\\scoop\\shims',
      'C:\\ProgramData\\chocolatey\\bin',
      'C:\\Program Files\\nodejs',
      'C:\\Program Files\\nodejs\\node_global',
    ])
  })
})

describe('computeHydratedLocaleEnv', () => {
  it('keeps locale unchanged when app is not packaged', () => {
    expect(
      computeHydratedLocaleEnv({
        isPackaged: false,
        platform: 'darwin',
        currentEnv: { LANG: 'en_US.UTF-8' },
        loginShellEnv: {
          LANG: 'en_US.UTF-8',
        },
      }),
    ).toEqual({})
  })

  it('hydrates packaged macOS locale from a UTF-8 login shell', () => {
    expect(
      computeHydratedLocaleEnv({
        isPackaged: true,
        platform: 'darwin',
        currentEnv: {
          LANG: 'C',
          LC_ALL: 'C',
        },
        loginShellEnv: {
          LANG: 'en_US.UTF-8',
          LC_CTYPE: 'en_US.UTF-8',
        },
      }),
    ).toEqual({
      LANG: 'en_US.UTF-8',
      LC_CTYPE: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
    })
  })

  it('keeps a packaged UTF-8 locale unchanged', () => {
    expect(
      computeHydratedLocaleEnv({
        isPackaged: true,
        platform: 'darwin',
        currentEnv: {
          LANG: 'en_US.UTF-8',
        },
        loginShellEnv: {
          LANG: 'en_US.UTF-8',
        },
      }),
    ).toEqual({})
  })

  it('falls back to a Linux UTF-8 locale when the login shell does not expose one', () => {
    expect(
      computeHydratedLocaleEnv({
        isPackaged: true,
        platform: 'linux',
        currentEnv: {
          LANG: 'C',
        },
        loginShellEnv: {},
      }),
    ).toEqual({
      LANG: 'C.UTF-8',
      LC_CTYPE: 'C.UTF-8',
    })
  })

  it('keeps Windows locale handling unchanged', () => {
    expect(
      computeHydratedLocaleEnv({
        isPackaged: true,
        platform: 'win32',
        currentEnv: {
          LANG: 'C',
        },
        loginShellEnv: {
          LANG: 'en_US.UTF-8',
        },
      }),
    ).toEqual({})
  })
})
