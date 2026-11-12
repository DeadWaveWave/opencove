// @vitest-environment node
import { expect, it } from 'vitest'
import {
  deriveNodeLineage,
  projectNodeLineage,
} from '../../../src/contexts/workspace/domain/nodeLineage'

it('projects missing rows as roots and increments immutable terminal-mediated ancestry', () => {
  expect(projectNodeLineage(null)).toEqual({
    spawnedBy: null,
    lineageDepth: 1,
    lineageStatus: 'root',
  })
  const child = deriveNodeLineage({ nodeId: 'child', callerNodeId: 'terminal', parent: null })
  expect(child).toEqual({
    nodeId: 'child',
    spawnedBy: 'terminal',
    rootNodeId: 'terminal',
    lineageDepth: 2,
  })
  const grandchild = deriveNodeLineage({
    nodeId: 'grandchild',
    callerNodeId: 'child',
    parent: child,
  })
  expect(projectNodeLineage(grandchild)).toEqual({
    spawnedBy: 'child',
    lineageDepth: 3,
    lineageStatus: 'recorded',
  })
  expect(grandchild.rootNodeId).toBe('terminal')
})

it('rejects self-parentage, reused ancestors and mismatched parent records', () => {
  expect(() => deriveNodeLineage({ nodeId: 'same', callerNodeId: 'same', parent: null })).toThrow()
  const parent = deriveNodeLineage({ nodeId: 'child', callerNodeId: 'root', parent: null })
  expect(() => deriveNodeLineage({ nodeId: 'root', callerNodeId: 'child', parent })).toThrow()
  expect(() => deriveNodeLineage({ nodeId: 'new', callerNodeId: 'other', parent })).toThrow()
})
