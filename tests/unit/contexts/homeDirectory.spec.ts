import { describe, expect, it } from 'vitest'
import { computeHomeDirectory } from '../../../src/platform/os/HomeDirectory'

describe('computeHomeDirectory', () => {
  it('prefers HOME when it is explicitly provided on Windows', () => {
    expect(
      computeHomeDirectory({
        env: {
          HOME: 'D:\\agent-home',
          USERPROFILE: 'C:\\Users\\tester',
        },
        platform: 'win32',
        osHomeDir: 'C:\\Users\\tester',
      }),
    ).toBe('D:\\agent-home')
  })

  it('falls back to USERPROFILE on Windows when HOME is absent', () => {
    expect(
      computeHomeDirectory({
        env: {
          USERPROFILE: 'C:\\Users\\tester',
        },
        platform: 'win32',
        osHomeDir: 'C:\\Users\\fallback',
      }),
    ).toBe('C:\\Users\\tester')
  })

  it('falls back to os.homedir when no environment override is set', () => {
    expect(
      computeHomeDirectory({
        env: {},
        platform: 'linux',
        osHomeDir: '/home/tester',
      }),
    ).toBe('/home/tester')
  })
})
