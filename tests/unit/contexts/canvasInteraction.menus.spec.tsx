import React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { WorkspaceCanvasMenus } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceCanvasMenus'
import { useWorkspaceCanvasNodeDragSession } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodeDragSession'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import { renderWithCanvasStore } from '../../support/canvasStoreTestHarness'
import { useCanvasInteraction } from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import type { CanvasInteractionState } from '../../../src/contexts/workspace/presentation/renderer/store/canvasStore.interaction'
import { seedWorkspaceCanvasStore } from '../../support/workspaceCanvasStoreHarness'
import { createRowNodes } from '../../support/canvasSelectionFixtures'
import type { WorkspaceSnapGuide } from '../../../src/contexts/workspace/presentation/renderer/utils/workspaceSnap'

type MenusProps = React.ComponentProps<typeof WorkspaceCanvasMenus>

function menusProps(): MenusProps {
  const noop = () => undefined
  const asyncNoop = async () => undefined
  return {
    nodes: [],
    workspacePath: '/tmp/repo',
    createTerminalNode: async () => undefined,
    createNoteNodeFromContextMenu: noop,
    createWebsiteNodeFromContextMenu: noop,
    createPluginNodeFromContextMenu: noop,
    createTaskFromContextMenu: noop,
    openRoleCreator: noop,
    openAgentLauncher: noop,
    openAgentLauncherForProvider: noop,
    projectRoles: [],
    runProjectRoleFromContextMenu: noop,
    openRoleEditor: noop,
    deleteProjectRole: noop,
    runQuickCommand: asyncNoop,
    insertQuickPhrase: asyncNoop,
    openQuickMenuSettings: noop,
    spaces: [],
    arrangeAll: noop,
    arrangeCanvas: noop,
    arrangeInSpace: noop,
    createSpaceFromSelectedNodes: noop,
    createChildSpaceInParent: () => null,
    createEmptySpaceAtPoint: noop,
    clearNodeSelection: noop,
    canConvertSelectedNoteToTask: false,
    isConvertSelectedNoteToTaskDisabled: false,
    convertSelectedNoteToTask: noop,
    setSelectedNodeLabelColorOverride: noop,
    setSpaceLabelColor: noop,
    openSpaceCreateWorktree: noop,
    openSpaceArchive: noop,
    copySpacePath: noop,
    openSpacePath: noop,
    agentSettings: DEFAULT_AGENT_SETTINGS,
    onChangePreserveWindowSizesOnArrange: noop,
  }
}

interface DragHolder {
  session: ReturnType<typeof useWorkspaceCanvasNodeDragSession> | null
  guides: WorkspaceSnapGuide[] | null
}

const selectSnapGuides = (interaction: CanvasInteractionState) => interaction.snapGuides

// The drag session of the canvas, beside the menus, in the same store; its guides are the slice's.
function DragSessionProbe({ holder }: { holder: DragHolder }): null {
  holder.guides = useCanvasInteraction(selectSnapGuides)
  holder.session = useWorkspaceCanvasNodeDragSession({ workspaceId: 'menus-toggle' })
  return null
}

describe('the context menu snapping toggle', () => {
  const nodes = createRowNodes(['a', 'b']).map(
    (node, index): Node<TerminalNodeData> => ({
      ...node,
      position: { x: index === 0 ? 0 : 1000, y: 0 },
      initialWidth: 200,
      initialHeight: 100,
    }),
  )

  // `b` is dragged to 4px from `a`'s right edge: with snapping on, a guide shows.
  const project = (session: ReturnType<typeof useWorkspaceCanvasNodeDragSession>) =>
    session.projectNodeDrag({
      currentNodes: nodes,
      draggedNodeIds: ['b'],
      desiredDraggedPositionById: new Map([['b', { x: 204, y: 0 }]]),
      dropFlowPoint: { x: 300, y: 50 },
      anchorNodeId: 'b',
      anchorIsSelected: false,
    })

  it('flips the slice, and a projected drag then shows no guide', async () => {
    seedWorkspaceCanvasStore({ workspaceId: 'test-workspace', nodes })
    const holder: DragHolder = { session: null, guides: null }
    const view = renderWithCanvasStore(
      <>
        <WorkspaceCanvasMenus {...menusProps()} />
        <DragSessionProbe holder={holder} />
      </>,
    )
    const projectNow = () => {
      act(() => {
        project(holder.session as NonNullable<DragHolder['session']>)
      })
    }
    // The app starts with snapping on; the test provider starts it off, so turn it on first.
    act(() => view.interaction.toggleMagneticSnapping())
    act(() => view.commands.openContextMenu({ kind: 'pane', x: 5, y: 5, flowX: 5, flowY: 5 }))
    const item = await screen.findByTestId('workspace-context-magnetic-snapping')
    expect(item.getAttribute('aria-checked')).toBe('true')
    projectNow()
    expect(holder.guides).not.toBeNull()

    fireEvent.click(item)

    expect(view.readInteraction().magneticSnappingEnabled).toBe(false)
    expect(
      (await screen.findByTestId('workspace-context-magnetic-snapping')).getAttribute(
        'aria-checked',
      ),
    ).toBe('false')
    projectNow()
    expect(holder.guides).toBeNull()

    fireEvent.click(await screen.findByTestId('workspace-context-magnetic-snapping'))
    expect(view.readInteraction().magneticSnappingEnabled).toBe(true)
    projectNow()
    expect(holder.guides).not.toBeNull()
  })
})
