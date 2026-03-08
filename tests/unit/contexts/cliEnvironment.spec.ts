import { describe, expect, it } from 'vitest'
import { computeHydratedCliPath } from '../../../src/platform/os/CliEnvironment'

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
      '/usr/sbin',
      '/sbin',
    ])
  })

  it('uses semicolon delimiter for windows and avoids posix-only fallback segments', () => {
    const path = computeHydratedCliPath({
      isPackaged: true,
      platform: 'win32',
      currentPath: 'C:\\Windows\\System32;C:\\Tools',
      homeDir: 'C:\\Users\\tester',
      shellPathFromLogin: 'C:\\Tools;D:\\bin',
    })

    expect(path).toBe('C:\\Windows\\System32;C:\\Tools;D:\\bin')
  })
})
