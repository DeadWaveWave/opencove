import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type {
  WorkspaceSpaceRect,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { useActiveExplorerSpace } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useActiveExplorerSpace'
import { createSpaceDragState } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceDrag.startState'
import { projectWorkspaceSpaceDragLayout } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceDrag.finalize'
import { resolveResizedSpaceRect } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceDrag.preview'

function space(
  id: string,
  rect: WorkspaceSpaceRect,
  parentSpaceId: string | null = null,
): WorkspaceSpaceState {
  return {
    id,
    name: id,
    directoryPath: '/project',
    targetMountId: null,
    parentSpaceId,
    labelColor: null,
    nodeIds: [],
    rect,
  }
}

describe('active Explorer Space display geometry', () => {
  it.each(['parent', 'child'])(
    'tracks a child Explorer during %s drag without writing durable Space geometry',
    draggedId => {
      const spaces = [
        space('parent', { x: 100, y: 100, width: 1000, height: 800 }),
        space('child', { x: 180, y: 180, width: 500, height: 400 }, 'parent'),
      ]
      const target = spaces.find(candidate => candidate.id === draggedId)!
      const dragState = createSpaceDragState({
        pointerId: 1,
        spaceId: draggedId,
        startFlow: { x: 0, y: 0 },
        startClient: { x: 0, y: 0 },
        shiftKey: false,
        targetSpace: target,
        handle: { kind: 'move' },
        nodes: [],
        spaces,
        selectedNodeIds: [],
      })
      const projected = projectWorkspaceSpaceDragLayout({
        dragState,
        dx: 90,
        dy: 70,
        nodes: [],
        spaces,
        resolveResizedRect: resolveResizedSpaceRect,
      })!
      const preview = new Map(projected.nextSpaces.map(item => [item.id, item.rect!]))
      const view = renderHook(
        ({ value, frames }) => useActiveExplorerSpace('child', value, frames),
        {
          initialProps: {
            value: spaces,
            frames: null as ReadonlyMap<string, WorkspaceSpaceRect> | null,
          },
        },
      )
      expect(view.result.current).toBe(spaces[1])
      view.rerender({ value: spaces, frames: preview })
      expect(view.result.current?.rect).toEqual({ x: 270, y: 250, width: 500, height: 400 })
      expect(spaces[1].rect).toEqual({ x: 180, y: 180, width: 500, height: 400 })
      const beforeRelease = view.result.current?.rect
      view.rerender({ value: projected.nextSpaces, frames: null })
      expect(view.result.current?.rect).toEqual(beforeRelease)
    },
  )

  it('ignores unrelated previews and cannot resurrect a removed or closed Explorer Space', () => {
    const spaces = [space('child', { x: 80, y: 90, width: 500, height: 400 })]
    const preview = new Map([['other', { x: 20, y: 30, width: 400, height: 300 }]])
    const view = renderHook(({ id, value }) => useActiveExplorerSpace(id, value, preview), {
      initialProps: { id: 'child' as string | null, value: spaces },
    })
    expect(view.result.current).toBe(spaces[0])
    view.rerender({ id: null, value: spaces })
    expect(view.result.current).toBeNull()
    view.rerender({ id: 'child', value: [] })
    expect(view.result.current).toBeNull()
  })
})
