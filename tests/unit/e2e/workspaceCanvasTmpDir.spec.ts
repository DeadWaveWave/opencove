import { afterEach, describe, expect, it, vi } from 'vitest'

const fsMock = vi.hoisted(() => ({
  accessSync: vi.fn(),
  existsSync: vi.fn(),
  statfsSync: vi.fn(),
}))

const osMock = vi.hoisted(() => ({
  tmpdir: vi.fn(() => '/system-tmp'),
}))

vi.mock('node:fs', () => ({
  accessSync: fsMock.accessSync,
  constants: { W_OK: 2 },
  existsSync: fsMock.existsSync,
  statfsSync: fsMock.statfsSync,
  default: {
    accessSync: fsMock.accessSync,
    constants: { W_OK: 2 },
    existsSync: fsMock.existsSync,
    statfsSync: fsMock.statfsSync,
  },
}))

vi.mock('node:os', () => ({
  tmpdir: osMock.tmpdir,
  default: {
    tmpdir: osMock.tmpdir,
  },
}))

import { resolveE2ETmpDir } from '../../e2e/workspace-canvas.testUtils'

describe('resolveE2ETmpDir', () => {
  const originalPlatform = process.platform

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    })
    osMock.tmpdir.mockReturnValue('/system-tmp')
  })

  it('prefers OPENCOVE_E2E_TMPDIR when explicitly configured', () => {
    vi.stubEnv('OPENCOVE_E2E_TMPDIR', '/explicit-tmp')

    expect(resolveE2ETmpDir()).toBe('/explicit-tmp')
    expect(fsMock.statfsSync).not.toHaveBeenCalled()
  })

  it('chooses the writable candidate with the most free space on linux CI', () => {
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      configurable: true,
    })
    vi.stubEnv('CI', '1')
    vi.stubEnv('RUNNER_TEMP', '/runner-tmp')
    osMock.tmpdir.mockReturnValue('/system-tmp')

    fsMock.existsSync.mockImplementation(targetPath => targetPath === '/mnt')
    fsMock.accessSync.mockImplementation(() => undefined)
    fsMock.statfsSync.mockImplementation(targetPath => {
      if (targetPath === '/mnt') {
        return { bavail: 500, bsize: 1024 }
      }

      if (targetPath === '/runner-tmp') {
        return { bavail: 200, bsize: 1024 }
      }

      return { bavail: 300, bsize: 1024 }
    })

    expect(resolveE2ETmpDir()).toBe('/mnt')
  })

  it('skips unwritable candidates and falls back to the remaining writable directory', () => {
    vi.stubEnv('RUNNER_TEMP', '/runner-tmp')
    osMock.tmpdir.mockReturnValue('/system-tmp')

    fsMock.existsSync.mockReturnValue(false)
    fsMock.accessSync.mockImplementation(targetPath => {
      if (targetPath === '/runner-tmp') {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      }
    })
    fsMock.statfsSync.mockImplementation(targetPath => {
      if (targetPath === '/system-tmp') {
        return { bavail: 100, bsize: 1024 }
      }

      return { bavail: 0, bsize: 1024 }
    })

    expect(resolveE2ETmpDir()).toBe('/system-tmp')
  })
})
