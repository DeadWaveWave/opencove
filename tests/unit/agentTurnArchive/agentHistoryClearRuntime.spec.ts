// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createWorkerAgentTurnArchiveRuntime } from '../../../src/app/main/controlSurface/agentTurnArchiveRuntime'
import {
  createAgentTurnArchive,
  type AgentTurnArchiveStorage,
} from '../../../src/contexts/agent/application/createAgentTurnArchive'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import { InMemoryAgentTurnArchive } from '../../support/agentTurnArchive/InMemoryAgentTurnArchive'
import { endedTurn } from '../../support/agentTurnArchive/agentTurnArchiveContract'

it('forwards Worker history clear after startup and reports unavailable before startup', async () => {
  const archive = new InMemoryAgentTurnArchive()
  const runtime = createWorkerAgentTurnArchiveRuntime({
    enabled: true,
    userDataPath: '/profile',
    open: () => archive,
    getPersistenceStore: async () =>
      ({
        readAppState: async () => ({
          formatVersion: 1,
          workspaces: [{ id: 'w', nodes: [{ id: 'node' }] }],
        }),
      }) as unknown as PersistenceStore,
  })
  try {
    expect(runtime.port.clearNode('node')).toEqual({ status: 'unavailable' })
    await runtime.start()
    runtime.port.append(endedTurn())
    expect(runtime.port.clearNode('node')).toEqual({ status: 'cleared', removed: 1 })
    expect(runtime.port.getExact({ nodeId: 'node', turnId: 'turn' })).toEqual({ status: 'absent' })
    expect(runtime.port.append(endedTurn({ turnId: 'later' }))).toEqual({ status: 'persisted' })
  } finally {
    runtime.dispose()
  }
})

it('reports unavailable and disables the optional archive when storage clear throws', () => {
  const dispose = vi.fn()
  const clearNode = vi.fn(() => {
    throw new Error('private I/O failure')
  })
  const archive = createAgentTurnArchive({
    clearNode,
    dispose,
  } as unknown as AgentTurnArchiveStorage)
  expect(archive.clearNode('node')).toEqual({ status: 'unavailable' })
  expect(dispose).toHaveBeenCalledOnce()
  expect(archive.clearNode('node')).toEqual({ status: 'unavailable' })
  expect(clearNode).toHaveBeenCalledOnce()
})

it('refuses a reentrant history clear without changing the outer append', () => {
  let archive: ReturnType<typeof createAgentTurnArchive>
  const clearNode = vi.fn()
  const storage = {
    clearNode,
    append: () => {
      expect(archive.clearNode('node')).toEqual({ status: 'unavailable' })
      return 'persisted'
    },
  } as unknown as AgentTurnArchiveStorage
  archive = createAgentTurnArchive(storage)
  expect(archive.append(endedTurn())).toEqual({ status: 'persisted' })
  expect(clearNode).not.toHaveBeenCalled()
})
