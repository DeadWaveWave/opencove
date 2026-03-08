import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  disposeAgentModelService,
  listAgentModels,
} from '../../../src/contexts/agent/infrastructure/cli/AgentModelService'

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn<typeof import('node:child_process').spawn>(),
}))

vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()

  return {
    ...actual,
    spawn: spawnMock,
    default: {
      ...actual,
      spawn: spawnMock,
    },
  }
})

const ORIGINAL_ENV = { ...process.env }

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

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  disposeAgentModelService()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('AgentModelService', () => {
  it('returns static Claude Code models without requiring api credentials', async () => {
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.CLAUDE_API_KEY
    delete process.env.CLAUDE_CODE_API_KEY
    delete process.env.CLAUDE_APIKEY

    const result = await listAgentModels('claude-code')

    expect(result.provider).toBe('claude-code')
    expect(result.source).toBe('claude-static')
    expect(result.error).toBeNull()
    expect(result.models.map(model => model.id)).toEqual([
      'claude-opus-4-6',
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
    ])
    expect(result.models.find(model => model.id === 'claude-sonnet-4-5-20250929')?.isDefault).toBe(
      true,
    )
  })

  it('keeps stdin open while waiting for codex model/list response', async () => {
    const mockedSpawn = vi.mocked(spawn)
    const child = createMockChildProcess()

    mockedSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const resultPromise = listAgentModels('codex')

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
    const mockedSpawn = vi.mocked(spawn)
    const child = createMockChildProcess()

    mockedSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const firstPromise = listAgentModels('codex')
    const secondPromise = listAgentModels('codex')

    expect(mockedSpawn).toHaveBeenCalledTimes(1)

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

    const mockedSpawn = vi.mocked(spawn)
    const child = createMockChildProcess()
    child.stdin.end = vi.fn(() => undefined)

    mockedSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const resultPromise = listAgentModels('codex')

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
})
