import { afterEach, describe, expect, it, vi } from 'vitest'

const originalPlatform = process.platform
const originalPath = process.env.PATH

afterEach(() => {
  Object.defineProperty(process, 'platform', {
    value: originalPlatform,
    configurable: true,
  })
  if (typeof originalPath === 'string') {
    process.env.PATH = originalPath
  } else {
    delete process.env.PATH
  }
  vi.doUnmock('node:child_process')
  vi.resetModules()
})

describe('AgentLaunchSpawnResolver on Windows', () => {
  it('launches through the detected terminal profile without host executable preflight', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    })
    process.env.PATH = 'C:\\Windows\\System32'

    vi.doMock('node:child_process', () => {
      const execFile = vi.fn((file, args, options, callback) => {
        const cb = typeof options === 'function' ? options : callback
        if (file === 'where.exe' && args?.[0] === 'powershell.exe') {
          cb?.(null, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\r\n', '')
          return
        }

        if (file === 'where.exe' && args?.[0] === 'powershell') {
          cb?.(null, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\r\n', '')
          return
        }

        cb?.(new Error(`not found: ${String(file)} ${String(args?.[0] ?? '')}`), '', '')
      })

      return {
        execFile,
        default: {
          execFile,
        },
      }
    })

    const { resolveAgentLaunchSpawn } =
      await import('../../../src/contexts/agent/infrastructure/cli/AgentLaunchSpawnResolver')

    const result = await resolveAgentLaunchSpawn({
      cwd: 'C:\\repo',
      profileId: null,
      command: 'claude',
      args: ['--model', 'sonnet'],
    })

    expect(result.command).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(result.cwd).toBe('C:\\repo')
    expect(result.profileId).toBe('powershell')
    expect(result.runtimeKind).toBe('windows')
    expect(result.args[0]).toBe('-NoLogo')
    expect(result.args[1]).toBe('-Command')
    expect(result.args[2]).toContain("& 'claude' '--model' 'sonnet'")
  })
})
