import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn<typeof import('node:child_process').spawn>(),
}))

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn<typeof import('node:child_process').execFile>(),
}))

vi.mock('node:child_process', () => {
  return {
    execFile: execFileMock,
    spawn: spawnMock,
    default: {
      execFile: execFileMock,
      spawn: spawnMock,
    },
  }
})

const ORIGINAL_ENV = { ...process.env }

async function importAgentModelService() {
  return await import('../../../src/contexts/agent/infrastructure/cli/AgentModelService')
}

type MockChildProcess = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: {
    write: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
  }
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  killed: boolean
  kill: ReturnType<typeof vi.fn>
}

function createMockChildProcess(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess

  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.killed = false
  child.kill = vi.fn((_signal?: NodeJS.Signals) => {
    child.killed = true
    return true
  })
  child.stdin = {
    write: vi.fn(() => true),
    end: vi.fn(() => {
      child.exitCode = 0
      child.signalCode = null
      child.emit('exit', 0, null)
    }),
  }

  return child
}

afterEach(async () => {
  process.env = { ...ORIGINAL_ENV }
  const { disposeAgentModelService } = await importAgentModelService()
  disposeAgentModelService()
  vi.clearAllMocks()
  vi.resetModules()
  vi.useRealTimers()
})

describe('AgentModelService', () => {
  const originalPlatform = process.platform

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    })
  })

  it('returns static Claude Code models without requiring api credentials', async () => {
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.CLAUDE_API_KEY
    delete process.env.CLAUDE_CODE_API_KEY
    delete process.env.CLAUDE_APIKEY

    const { listAgentModels } = await importAgentModelService()
    const result = await listAgentModels('claude-code')

    expect(result.provider).toBe('claude-code')
    expect(result.source).toBe('claude-static')
    expect(result.error).toBeNull()
    expect(result.models.map(model => model.id)).toEqual([
      'claude-sonnet-4-6',
      'claude-sonnet-4-6[1m]',
      'claude-opus-4-6',
      'claude-opus-4-6[1m]',
    ])
    expect(result.models.find(model => model.id === 'claude-sonnet-4-6')?.isDefault).toBe(true)
  })

  it('lists OpenCode models from the CLI output', async () => {
    execFileMock.mockImplementation((_file, _args, options, callback) => {
      const cb = typeof options === 'function' ? options : callback
      cb?.(null, 'opencode/gpt-5-nano\nopenrouter/gpt-5\n', '')
      return {} as ReturnType<typeof execFileMock>
    })

    const { listAgentModels } = await importAgentModelService()
    const result = await listAgentModels('opencode')

    expect(result.provider).toBe('opencode')
    expect(result.source).toBe('opencode-cli')
    expect(result.error).toBeNull()
    expect(result.models.map(model => model.id)).toEqual([
      'opencode/gpt-5-nano',
      'openrouter/gpt-5',
    ])
  })

  it('returns Gemini models parsed from the settings schema', async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => {
          return {
            properties: {
              modelConfigs: {
                default: {
                  modelDefinitions: {
                    'gemini-3.1-pro-preview': { isVisible: true },
                    'gemini-3-pro-preview': { isVisible: true },
                    'gemini-3-flash-preview': { isVisible: true },
                    'gemini-2.5-pro': { isVisible: true },
                    'gemini-2.5-flash': { isVisible: true },
                    'gemini-2.5-flash-lite': { isVisible: true },
                    'auto-gemini-3': { isVisible: true },
                    'auto-gemini-2.5': { isVisible: true },
                    internal: { isVisible: false },
                  },
                  modelIdResolutions: {
                    auto: { default: 'gemini-3-pro-preview' },
                    pro: { default: 'gemini-3-pro-preview' },
                    flash: { default: 'gemini-3-flash-preview' },
                    'flash-lite': { default: 'gemini-2.5-flash-lite' },
                  },
                },
              },
            },
          }
        },
      }
    })

    vi.stubGlobal('fetch', fetchMock as never)

    try {
      const { listAgentModels } = await importAgentModelService()
      const result = await listAgentModels('gemini')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(result.provider).toBe('gemini')
      expect(result.source).toBe('gemini-cli')
      expect(result.error).toBeNull()
      expect(result.models.map(model => model.id)).toEqual([
        'auto',
        'pro',
        'flash',
        'flash-lite',
        'auto-gemini-3',
        'auto-gemini-2.5',
        'gemini-3.1-pro-preview',
        'gemini-3-pro-preview',
        'gemini-3-flash-preview',
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
      ])
      expect(result.models.find(model => model.id === 'auto')?.isDefault).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps stdin open while waiting for codex model/list response', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
    })

    const child = createMockChildProcess()

    spawnMock.mockReturnValue(child as never)

    const { listAgentModels } = await importAgentModelService()
    const resultPromise = listAgentModels('codex')
    await Promise.resolve()

    expect(child.stdin.write).toHaveBeenCalledTimes(2)
    expect(child.stdin.end).not.toHaveBeenCalled()

    child.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          id: '2',
          result: {
            data: [
              {
                id: 'gpt-5.2-codex',
                displayName: 'gpt-5.2-codex',
                description: 'Frontier model',
                isDefault: true,
              },
            ],
          },
        })}\n`,
      ),
    )

    const result = await resultPromise

    expect(result.provider).toBe('codex')
    expect(result.source).toBe('codex-cli')
    expect(result.error).toBeNull()
    expect(result.models).toEqual([
      {
        id: 'gpt-5.2-codex',
        displayName: 'gpt-5.2-codex',
        description: 'Frontier model',
        isDefault: true,
      },
    ])
    expect(child.stdin.end).toHaveBeenCalledTimes(1)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent codex model fetches', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
    })

    const child = createMockChildProcess()

    spawnMock.mockReturnValue(child as never)

    const { listAgentModels } = await importAgentModelService()
    const firstPromise = listAgentModels('codex')
    const secondPromise = listAgentModels('codex')
    await Promise.resolve()

    expect(spawnMock).toHaveBeenCalledTimes(1)

    child.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          id: '2',
          result: {
            data: [
              {
                id: 'gpt-5.2-codex',
                displayName: 'gpt-5.2-codex',
                description: '',
                isDefault: true,
              },
            ],
          },
        })}\n`,
      ),
    )

    const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise])

    expect(firstResult.models.map(model => model.id)).toEqual(['gpt-5.2-codex'])
    expect(secondResult.models.map(model => model.id)).toEqual(['gpt-5.2-codex'])
  })

  it('falls back to SIGKILL when codex app-server ignores SIGTERM', async () => {
    vi.useFakeTimers()
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
    })

    const child = createMockChildProcess()
    child.stdin.end = vi.fn(() => undefined)

    spawnMock.mockReturnValue(child as never)

    const { listAgentModels } = await importAgentModelService()
    const resultPromise = listAgentModels('codex')
    await Promise.resolve()

    child.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          id: '2',
          result: {
            data: [
              {
                id: 'gpt-5.2-codex',
                displayName: 'gpt-5.2-codex',
                description: '',
                isDefault: true,
              },
            ],
          },
        })}\n`,
      ),
    )

    await resultPromise

    expect(child.kill).toHaveBeenCalledWith('SIGTERM')

    await vi.advanceTimersByTimeAsync(500)

    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('uses the Windows cmd shim path when codex resolves to a .cmd launcher', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    })

    const child = createMockChildProcess()

    execFileMock.mockImplementation((_file, _args, options, callback) => {
      const cb = typeof options === 'function' ? options : callback
      cb?.(null, 'C:\\Users\\deadwave\\AppData\\Roaming\\npm\\codex.cmd\r\n', '')
      return {} as ReturnType<typeof execFileMock>
    })
    spawnMock.mockReturnValue(child as never)

    const { listAgentModels } = await importAgentModelService()
    const resultPromise = listAgentModels('codex')
    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalledTimes(1)
    })

    expect(spawnMock).toHaveBeenCalledWith(
      'cmd.exe',
      ['/d', '/c', 'C:\\Users\\deadwave\\AppData\\Roaming\\npm\\codex.cmd', 'app-server'],
      expect.objectContaining({
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      }),
    )

    child.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          id: '2',
          result: {
            data: [
              {
                id: 'gpt-5.2-codex',
                displayName: 'gpt-5.2-codex',
                description: '',
                isDefault: true,
              },
            ],
          },
        })}\n`,
      ),
    )

    await expect(resultPromise).resolves.toEqual(
      expect.objectContaining({
        provider: 'codex',
        source: 'codex-cli',
        error: null,
      }),
    )
  })
})
