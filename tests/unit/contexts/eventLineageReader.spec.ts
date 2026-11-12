import { expect, it, vi } from 'vitest'
import { EventLineageReader } from '../../../src/contexts/workspace/application/nodeLineage/EventLineageReader'
it('matches direct children and a subtree including future descendants and deleted parents', async () => {
  const records = new Map([
    ['child', { nodeId: 'child', spawnedBy: 'deleted', rootNodeId: 'root', lineageDepth: 3 }],
    ['deleted', { nodeId: 'deleted', spawnedBy: 'root', rootNodeId: 'root', lineageDepth: 2 }],
  ])
  const readMany = vi.fn(async () => records)
  const reader = new EventLineageReader({ readMany })
  expect(await reader.matches('child', { spawnedBy: 'deleted' })).toBe(true)
  expect(await reader.matches('child', { spawnedBy: 'root' })).toBe(false)
  expect(await reader.matches('child', { lineage: 'root' })).toBe(true)
  expect(await reader.matches('root', { lineage: 'root' })).toBe(true)
  const calls = readMany.mock.calls.length
  expect(await reader.matches('child', { lineage: 'root' })).toBe(true)
  expect(readMany).toHaveBeenCalledTimes(calls)
  records.set('new', { nodeId: 'new', spawnedBy: 'child', rootNodeId: 'root', lineageDepth: 4 })
  expect(await reader.matches('new', { lineage: 'root' })).toBe(true)
})
it('fails explicitly on unreadable ancestry, cycles and work limits', async () => {
  const failing = new EventLineageReader({
    readMany: async () => {
      throw new Error('offline')
    },
  })
  await expect(failing.matches('child', { lineage: 'root' })).rejects.toThrow()
  const cyclic = new EventLineageReader({
    readMany: async () =>
      new Map([
        ['a', { nodeId: 'a', spawnedBy: 'b', rootNodeId: 'root', lineageDepth: 2 }],
        ['b', { nodeId: 'b', spawnedBy: 'a', rootNodeId: 'root', lineageDepth: 2 }],
      ]),
  })
  await expect(cyclic.matches('a', { lineage: 'root' })).rejects.toThrow('cycle')
  const bounded = new EventLineageReader(
    {
      readMany: async () =>
        new Map([['a', { nodeId: 'a', spawnedBy: 'b', rootNodeId: 'root', lineageDepth: 2 }]]),
    },
    1,
  )
  await expect(bounded.matches('a', { lineage: 'root' })).rejects.toThrow('work limit')
})
