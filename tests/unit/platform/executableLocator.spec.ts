import { afterEach, describe, expect, it, vi } from 'vitest'

const { statMock } = vi.hoisted(() => ({
  statMock: vi.fn(),
}))

const { getShellEnvironmentSnapshotMock } = vi.hoisted(() => ({
  getShellEnvironmentSnapshotMock: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  default: {
    stat: statMock,
  },
  stat: statMock,
}))

vi.mock('../../../src/platform/os/ShellEnvironmentService', () => ({
  getShellEnvironmentSnapshot: getShellEnvironmentSnapshotMock,
}))

const ORIGINAL_ENV = { ...process.env }
const ORIGINAL_PLATFORM = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  })
}

function mockExecutablePaths(paths: string[]): void {
  const executablePaths = new Set(paths)

  statMock.mockImplementation(async (filePath: string) => {
    if (!executablePaths.has(filePath)) {
      throw new Error(`ENOENT: ${filePath}`)
    }

    return {
      isFile: () => true,
      mode: 0o755,
    }
  })
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  setPlatform(ORIGINAL_PLATFORM)
  vi.clearAllMocks()
  vi.resetModules()
})

describe('ExecutableLocator', () => {
  it('resolves an explicit override path before consulting PATH sources', async () => {
    setPlatform('darwin')
    mockExecutablePaths(['/custom/bin/codex'])

    const { locateExecutable } = await import('../../../src/platform/process/ExecutableLocator')
    const result = await locateExecutable({
      toolId: 'codex',
      command: 'codex',
      overridePath: '/custom/bin/codex',
    })

    expect(result).toEqual({
      toolId: 'codex',
      command: 'codex',
      executablePath: '/custom/bin/codex',
      source: 'override',
      status: 'resolved',
      diagnostics: ['Resolved codex from explicit override.'],
    })
    expect(getShellEnvironmentSnapshotMock).not.toHaveBeenCalled()
  })

  it('prefers shell-derived PATH entries over the current process PATH', async () => {
    setPlatform('darwin')
    process.env.PATH = '/process/bin'
    mockExecutablePaths(['/shell/bin/codex', '/process/bin/codex'])
    getShellEnvironmentSnapshotMock.mockResolvedValue({
      env: { PATH: '/shell/bin' },
      shellPath: '/bin/zsh',
      source: 'default_shell',
      diagnostics: ['shell captured'],
    })

    const { locateExecutable } = await import('../../../src/platform/process/ExecutableLocator')
    const result = await locateExecutable({
      toolId: 'codex',
      command: 'codex',
    })

    expect(result.executablePath).toBe('/shell/bin/codex')
    expect(result.source).toBe('shell_env_path')
    expect(result.status).toBe('resolved')
    expect(result.diagnostics).toContain('shell captured')
    expect(result.diagnostics).toContain('Resolved codex from shell-derived PATH.')
  })

  it('returns invalid_override when an override does not point to an executable', async () => {
    setPlatform('darwin')
    mockExecutablePaths([])

    const { locateExecutable } = await import('../../../src/platform/process/ExecutableLocator')
    const result = await locateExecutable({
      toolId: 'codex',
      command: 'codex',
      overridePath: '/missing/codex',
    })

    expect(result).toEqual({
      toolId: 'codex',
      command: 'codex',
      executablePath: null,
      source: null,
      status: 'invalid_override',
      diagnostics: ['Configured override was not executable: /missing/codex'],
    })
    expect(getShellEnvironmentSnapshotMock).not.toHaveBeenCalled()
  })
})
