import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { useWorkspaceCanvasNodeCreation } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore.createNodes'
import { resolveNodesPlacement } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore.resolvePlacement'
import { assignNodeToSpaceAndExpand } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.spaceAssignment'
import { useCanvasCollapseStore } from '@contexts/workspace/presentation/renderer/store/useCanvasCollapseStore'
import { EMPTY_CANVAS_COLLAPSE } from '@contexts/workspace/presentation/renderer/utils/canvasCollapse'
import { projectCanvasInteractionLayout } from '@contexts/workspace/presentation/renderer/utils/canvasInteractionLayout'
import { isPositionAvailable } from '@contexts/workspace/domain/workspaceNodePlacement'

vi.mock('@app/renderer/i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const workspaceId = 'creation-visible-geometry'

function node(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Node<TerminalNodeData> {
  return {
    id,
    type: 'noteNode',
    position: { x, y },
    data: { kind: 'note', width, height, title: id, note: { text: '' } } as TerminalNodeData,
  }
}

function space(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  nodeIds: string[],
): WorkspaceSpaceState {
  return {
    id,
    name: id,
    directoryPath: '/repo',
    targetMountId: null,
    labelColor: null,
    rect: { x, y, width, height },
    nodeIds,
  }
}

beforeEach(() => {
  useCanvasCollapseStore.setState({
    workspaces: {
      [workspaceId]: { ...EMPTY_CANVAS_COLLAPSE, collapsedNodeIds: { compact: true } },
    },
  })
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: { pty: { kill: vi.fn() } },
  })
})
afterEach(cleanup)

describe('creation uses the visible geometry of every window kind', () => {
  it('uses room beside a compact icon without reserving its saved expanded dimensions', () => {
    const compact = node('compact', 124, 124, 1200, 900)
    const target = space('target', 100, 100, 760, 400, [compact.id])
    const result = resolveNodesPlacement({
      workspaceId,
      anchor: { x: 276, y: 124 },
      size: { width: 340, height: 260 },
      getNodes: () => [compact],
      getSpaces: () => [target],
      targetSpaceRect: target.rect,
    })
    expect(result).toEqual({ placement: { x: 276, y: 124 }, canPlace: true })
    expect(compact.data).toMatchObject({ width: 1200, height: 900 })
  })

  for (const nesting of ['root', 'child'] as const) {
    it.each(['agent', 'terminal', 'note'] as const)(
      `creates %s in a packed ${nesting} Space and grows its ancestors`,
      async kind => {
        const compact = node('compact', 124, 124, 1200, 900)
        const expanded = node('expanded', 276, 124, 340, 260)
        const target = space('target', 100, 100, 540, 308, ['compact', 'expanded'])
        const parent = space('parent', 76, 76, 588, 356, [])
        if (nesting === 'child') {
          target.parentSpaceId = parent.id
        }
        const spacesRef = { current: nesting === 'child' ? [parent, target] : [target] }
        const nodesRef = { current: [compact, expanded] }
        const setNodes = (
          update: (previous: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
        ) => {
          nodesRef.current = update(nodesRef.current)
        }
        const onShowMessage = vi.fn()
        const { result } = renderHook(() =>
          useWorkspaceCanvasNodeCreation({
            workspaceId,
            nodesRef,
            spacesRef,
            setNodes,
            onShowMessage,
            standardWindowSizeBucket: 'regular',
            browserDefaultMode: 'native',
          }),
        )
        let created: Node<TerminalNodeData> | null = null
        await act(async () => {
          const placement = { targetSpaceRect: target.rect, preferredDirection: 'down' as const }
          created =
            kind === 'note'
              ? result.current.createNoteNode({ x: 124, y: 124 }, { placement })
              : await result.current.createNodeForSession({
                  sessionId: 'new-session',
                  runtimeKind: 'posix',
                  title: kind,
                  kind,
                  anchor: { x: 124, y: 124 },
                  placement,
                })
        })
        expect(created).not.toBeNull()
        expect(onShowMessage).not.toHaveBeenCalled()
        const added = created as unknown as Node<TerminalNodeData>
        assignNodeToSpaceAndExpand({
          workspaceId,
          createdNodeId: added.id,
          createdNode: added,
          targetSpaceId: target.id,
          spacesRef,
          nodesRef,
          setNodes,
          onSpacesChange: spaces => {
            spacesRef.current = spaces
          },
        })
        const view = projectCanvasInteractionLayout(
          nodesRef.current,
          spacesRef.current,
          useCanvasCollapseStore.getState().workspaces[workspaceId],
        )
        const targetAfter = view.spaces.find(item => item.id === target.id)!
        expect(targetAfter.nodeIds).toContain(added.id)
        expect(targetAfter.rect!.height).toBeGreaterThan(target.rect!.height)
        expect(targetAfter.rect!.x + targetAfter.rect!.width).toBeLessThan(124 + compact.data.width)
        for (const visible of view.nodes) {
          expect(isPositionAvailable(visible.position, visible.data, view.nodes, visible.id)).toBe(
            true,
          )
          expect(visible.position.x).toBeGreaterThanOrEqual(targetAfter.rect!.x + 24)
          expect(visible.position.y).toBeGreaterThanOrEqual(targetAfter.rect!.y + 24)
          expect(visible.position.x + visible.data.width).toBeLessThanOrEqual(
            targetAfter.rect!.x + targetAfter.rect!.width - 24,
          )
          expect(visible.position.y + visible.data.height).toBeLessThanOrEqual(
            targetAfter.rect!.y + targetAfter.rect!.height - 24,
          )
        }
        expect(nodesRef.current.find(item => item.id === compact.id)?.data).toMatchObject({
          width: 1200,
          height: 900,
        })
        if (nesting === 'child') {
          const parentAfter = view.spaces.find(item => item.id === parent.id)!.rect!
          expect(parentAfter.height).toBeGreaterThan(parent.rect!.height)
          expect(targetAfter.rect!.y + targetAfter.rect!.height).toBeLessThanOrEqual(
            parentAfter.y + parentAfter.height - 24,
          )
        }
      },
    )
  }
})
