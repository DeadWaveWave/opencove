import { expect, it } from 'vitest'
import { normalizePersistedAppState } from '../../../src/platform/persistence/sqlite/normalize'
import { planSpaceUpdate } from '../../../src/contexts/workspace/application/nodeControl/spaceUpdateLayout'

it.each(['target', 'ancestor', 'both'] as const)(
  'uses compact dimensions for %s members without changing canonical sizes',
  scope => {
    const compactTarget = scope !== 'ancestor'
    const compactAncestor = scope !== 'target'
    const targetRect = {
      x: 0,
      y: 0,
      width: compactTarget ? 224 : 698,
      height: compactTarget ? 144 : 528,
    }
    const ancestorRect = { x: -12, y: -12, width: 1500, height: 800 }
    const workspace = normalizePersistedAppState({
      formatVersion: 1,
      settings: {},
      activeWorkspaceId: 'p',
      workspaces: [
        {
          id: 'p',
          name: 'P',
          path: '/repo',
          collapsedNodeIds: [
            ...(compactTarget ? ['member'] : []),
            ...(compactAncestor ? ['ancestor-member'] : []),
          ],
          nodes: [
            { id: 'member', kind: 'terminal', position: { x: 34, y: 24 }, width: 640, height: 480 },
            {
              id: 'ancestor-member',
              kind: 'terminal',
              position: { x: 1200, y: 24 },
              width: 640,
              height: 480,
            },
          ],
          spaces: [
            { id: 'parent', nodeIds: ['ancestor-member'], rect: ancestorRect },
            { id: 's', parentSpaceId: 'parent', nodeIds: ['member'], rect: targetRect },
          ],
        },
      ],
    })!.workspaces[0]
    const result = planSpaceUpdate(workspace, { spaceId: 's', frame: { x: 10 } })
    expect(result.space.rect).toEqual({ ...targetRect, x: 10 })
    expect(result.workspace.spaces[0].rect).toEqual(
      compactAncestor ? ancestorRect : { ...ancestorRect, width: 1876 },
    )
    expect(result.workspace.nodes).toBe(workspace.nodes)
    expect(result.workspace.nodes[1]).toBe(workspace.nodes[1])
    expect(result.workspace.collapsedNodeIds).toEqual(workspace.collapsedNodeIds)
  },
)
