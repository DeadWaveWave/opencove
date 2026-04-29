import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import type { PersistWriteResult } from '../../../src/shared/contracts/dto/persistence'
import {
  clearScheduledScrollbackWrites,
  flushScheduledScrollbackWrites,
  scheduleAgentPlaceholderScrollbackWrite,
  scheduleNodeScrollbackWrite,
} from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/scrollbackSchedule'
import { persistNodeScrollback } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore.scrollbackPersistence'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'

type MockPersistenceApi = {
  writeNodeScrollback: ReturnType<typeof vi.fn>
  writeAgentNodePlaceholderScrollback: ReturnType<typeof vi.fn>
}

function createWriteResult(): PersistWriteResult {
  return { ok: true, level: 'full', bytes: 0 }
}

function getMockPersistence(): MockPersistenceApi {
  return window.opencoveApi.persistence as unknown as MockPersistenceApi
}

describe('scrollbackSchedule', () => {
  beforeEach(() => {
    vi.useFakeTimers()

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        persistence: {
          writeNodeScrollback: vi.fn(async () => createWriteResult()),
          writeAgentNodePlaceholderScrollback: vi.fn(async () => createWriteResult()),
        },
      },
    })
  })

  afterEach(async () => {
    flushScheduledScrollbackWrites()
    await vi.advanceTimersByTimeAsync(0)
    vi.useRealTimers()
  })

  it('persists terminal scrollback through the renderer schedule', async () => {
    const persistence = getMockPersistence()

    scheduleNodeScrollbackWrite('node-1', 'terminal history', { delayMs: 25 })

    expect(persistence.writeNodeScrollback).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(25)

    expect(persistence.writeNodeScrollback).toHaveBeenCalledTimes(1)
    expect(persistence.writeNodeScrollback).toHaveBeenCalledWith({
      nodeId: 'node-1',
      scrollback: 'terminal history',
    })
    expect(persistence.writeAgentNodePlaceholderScrollback).not.toHaveBeenCalled()
  })

  it('persists agent placeholder scrollback through the renderer schedule', async () => {
    const persistence = getMockPersistence()

    scheduleAgentPlaceholderScrollbackWrite('agent-1', 'agent placeholder', { delayMs: 25 })

    await vi.advanceTimersByTimeAsync(25)

    expect(persistence.writeAgentNodePlaceholderScrollback).toHaveBeenCalledTimes(1)
    expect(persistence.writeAgentNodePlaceholderScrollback).toHaveBeenCalledWith({
      nodeId: 'agent-1',
      scrollback: 'agent placeholder',
    })
    expect(persistence.writeNodeScrollback).not.toHaveBeenCalled()
  })

  it('does not persist agent renderer scrollback from mounted nodes', async () => {
    const persistence = getMockPersistence()
    const agentNode = {
      id: 'agent-1',
      data: {
        kind: 'agent',
      },
    } as Node<TerminalNodeData>

    persistNodeScrollback(agentNode, 'agent renderer cache')
    await vi.advanceTimersByTimeAsync(0)

    expect(persistence.writeAgentNodePlaceholderScrollback).not.toHaveBeenCalled()
    expect(persistence.writeNodeScrollback).not.toHaveBeenCalled()
  })

  it('clears both terminal and agent placeholder persistence for a node', async () => {
    const persistence = getMockPersistence()

    clearScheduledScrollbackWrites('node-1')
    await vi.advanceTimersByTimeAsync(0)

    expect(persistence.writeNodeScrollback).toHaveBeenCalledWith({
      nodeId: 'node-1',
      scrollback: null,
    })
    expect(persistence.writeAgentNodePlaceholderScrollback).toHaveBeenCalledWith({
      nodeId: 'node-1',
      scrollback: null,
    })
  })
})
