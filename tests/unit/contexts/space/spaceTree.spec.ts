import { describe, expect, it } from 'vitest'
import {
  collectAncestorSpaces,
  collectSpaceSubtree,
  collectSpaceSubtreeIds,
  collectSpaceSubtreeNodeIds,
  mapNodeIdToOwningSpaceId,
} from '../../../../src/contexts/space/application/spaceTree'

const spaces = [
  { id: 'root-a', parentSpaceId: null, nodeIds: ['node-a'] },
  { id: 'child-a', parentSpaceId: 'root-a', nodeIds: ['node-b'] },
  { id: 'grandchild-a', parentSpaceId: 'child-a', nodeIds: ['node-c'] },
  { id: 'root-b', parentSpaceId: null, nodeIds: ['node-d'] },
  { id: 'child-b', parentSpaceId: 'root-b', nodeIds: ['node-e'] },
]

describe('spaceTree', () => {
  it('collects a target Space subtree without crossing sibling roots', () => {
    expect(collectSpaceSubtree(spaces, 'root-a').map(space => space.id)).toEqual([
      'root-a',
      'child-a',
      'grandchild-a',
    ])
    expect([...collectSpaceSubtreeIds(spaces, 'child-a')]).toEqual(['child-a', 'grandchild-a'])
    expect([...collectSpaceSubtreeNodeIds(spaces, 'root-a')]).toEqual([
      'node-a',
      'node-b',
      'node-c',
    ])
  })

  it('collects ancestors from nearest parent upward and stops on broken links', () => {
    expect(collectAncestorSpaces(spaces, 'grandchild-a').map(space => space.id)).toEqual([
      'child-a',
      'root-a',
    ])
    expect(collectAncestorSpaces(spaces, 'missing')).toEqual([])
  })

  it('maps each node to the first owning Space for stable archive ownership', () => {
    expect(mapNodeIdToOwningSpaceId([...spaces, { id: 'duplicate', nodeIds: ['node-b'] }])).toEqual(
      new Map([
        ['node-a', 'root-a'],
        ['node-b', 'child-a'],
        ['node-c', 'grandchild-a'],
        ['node-d', 'root-b'],
        ['node-e', 'child-b'],
      ]),
    )
  })
})
