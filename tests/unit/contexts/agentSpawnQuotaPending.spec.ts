import { expect, it, vi } from 'vitest'
import { AgentSpawnAdmissionOwner } from '../../../src/contexts/workspace/application/nodeSpawn/AgentSpawnAdmissionOwner'
import type { NodeControlAppStateStore } from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'
import type { ResolvedNodeCreationTarget } from '../../../src/contexts/workspace/application/nodeControl/nodeCreationTarget'

it('reports a starting reservation before a binding exists and releases it on settled failure', async () => {
  const owner = new AgentSpawnAdmissionOwner({
    snapshot: () => ({ revision: 0, bindings: [] }),
    isCurrent: () => true,
  })
  const store = {
    readAppStateRevision: async () => 0,
    readAppState: async () => ({
      workspaces: [{ nodes: [{ id: 'root', kind: 'agent', sessionId: 's' }] }],
    }),
    nodeLineage: { readMany: async () => new Map(), readAll: async () => new Map() },
    commitCreatedNodeState: vi.fn(),
  } as unknown as NodeControlAppStateStore
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const create = vi.fn(async () => {
    await gate
    throw Error('launch failed')
  })
  const pending = owner.runCreation(
    store,
    {
      nodeId: 'child',
      kind: 'terminal',
      title: 'Starting helper',
      authority: { nodeId: 'root', sessionId: 's', grantId: 'g' },
      target: { endpoint: { kind: 'local' } } as ResolvedNodeCreationTarget,
      assertActive: () => {},
    },
    create,
  )
  try {
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(await owner.lineageQuota(store, 'root')).toEqual({
      depth: 1,
      maxDepth: 3,
      liveInTree: 1,
      maxLiveInTree: 6,
    })
  } finally {
    release()
    await expect(pending).rejects.toThrow('launch failed')
  }
  expect((await owner.lineageQuota(store, 'root')).liveInTree).toBe(0)
})
