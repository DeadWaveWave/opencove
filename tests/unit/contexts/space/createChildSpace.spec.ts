import { describe, expect, it } from 'vitest'
import {
  createChildSpace,
  type ChildSpaceRecord,
} from '../../../../src/contexts/space/application/createChildSpace'
import { createMountOnlySpaceBoundary } from '../../../../src/shared/types/spaceBoundary'

function createParentSpace(overrides: Partial<ChildSpaceRecord> = {}): ChildSpaceRecord {
  return {
    id: 'parent-space',
    name: 'Parent',
    directoryPath: '/repo',
    targetMountId: 'mount-1',
    parentSpaceId: null,
    boundary: createMountOnlySpaceBoundary({
      mountId: 'mount-1',
      rootPath: '/repo/packages/app',
      rootUri: 'file:///repo/packages/app',
    }),
    sortOrder: 4,
    labelColor: null,
    nodeIds: ['node-a', 'node-b'],
    rect: { x: 0, y: 0, width: 1200, height: 800 },
    ...overrides,
  }
}

describe('createChildSpace', () => {
  it('creates a child with inherited boundary and atomically moves selected nodes', () => {
    const parent = createParentSpace()

    const result = createChildSpace({
      spaces: [parent],
      workspacePath: '/repo',
      nodeFrames: [
        { id: 'node-a', x: 100, y: 120, width: 320, height: 200 },
        { id: 'node-b', x: 640, y: 160, width: 320, height: 200 },
      ],
      input: {
        parentSpaceId: parent.id,
        initialNodeIds: ['node-a'],
      },
      createId: () => 'child-space',
      defaultName: count => `Child ${count}`,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.childSpace).toMatchObject({
      id: 'child-space',
      name: 'Child 1',
      directoryPath: '/repo/packages/app',
      targetMountId: 'mount-1',
      parentSpaceId: 'parent-space',
      sortOrder: 5,
      nodeIds: ['node-a'],
      rect: { x: 82, y: 102, width: 420, height: 300 },
    })
    expect(result.childSpace.boundary).toEqual(parent.boundary)
    expect(result.movedNodeIds).toEqual(['node-a'])
    expect(result.nextSpaces).toHaveLength(2)
    expect(result.nextSpaces.find(space => space.id === parent.id)?.nodeIds).toEqual(['node-b'])
    expect(result.nextSpaces.find(space => space.id === 'child-space')?.nodeIds).toEqual(['node-a'])
  })

  it('rejects nested child creation from the UI-level default path', () => {
    const childParent = createParentSpace({
      id: 'child-parent',
      parentSpaceId: 'parent-space',
    })

    const result = createChildSpace({
      spaces: [childParent],
      workspacePath: '/repo',
      nodeFrames: [],
      input: { parentSpaceId: childParent.id },
      createId: () => 'child-space',
      defaultName: count => `Child ${count}`,
    })

    expect(result).toEqual({ ok: false, code: 'nested_parent_not_allowed' })
  })

  it('rejects moving nodes that are not currently owned by the parent', () => {
    const parent = createParentSpace()

    const result = createChildSpace({
      spaces: [parent],
      workspacePath: '/repo',
      nodeFrames: [{ id: 'node-c', x: 100, y: 120, width: 320, height: 200 }],
      input: {
        parentSpaceId: parent.id,
        initialNodeIds: ['node-c'],
      },
      createId: () => 'child-space',
      defaultName: count => `Child ${count}`,
    })

    expect(result).toEqual({ ok: false, code: 'nodes_not_in_parent' })
  })
})
