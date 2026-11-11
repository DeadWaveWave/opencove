import { describe, expect, it } from 'vitest'
import { assertGrantRuntimeSpawnAllowed } from '../../../src/contexts/workspace/domain/agentSpawnPolicy'

describe('grant runtime admission policy', () => {
  it.each([2, 3])('admits depth %i', depth => {
    expect(() =>
      assertGrantRuntimeSpawnAllowed({
        lineage: { nodeId: 'child', spawnedBy: 'caller', rootNodeId: 'root', lineageDepth: depth },
        occupied: 5,
        kind: 'agent',
      }),
    ).not.toThrow()
  })
  it('refuses depth four and a seventh live descendant', () => {
    const lineage = { nodeId: 'child', spawnedBy: 'caller', rootNodeId: 'root', lineageDepth: 4 }
    expect(() =>
      assertGrantRuntimeSpawnAllowed({ lineage, occupied: 0, kind: 'terminal' }),
    ).toThrow(expect.objectContaining({ code: 'agent.spawn_depth_limit' }))
    expect(() =>
      assertGrantRuntimeSpawnAllowed({
        lineage: { ...lineage, lineageDepth: 2 },
        occupied: 6,
        kind: 'agent',
      }),
    ).toThrow(expect.objectContaining({ code: 'agent.spawn_concurrency_limit' }))
  })
})
