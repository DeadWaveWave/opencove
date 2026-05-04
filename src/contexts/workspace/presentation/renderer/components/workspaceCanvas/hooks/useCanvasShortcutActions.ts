import { useCallback } from 'react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { CreateNodeInput } from '../types'
import {
  createNoteNodeAtFlowPosition,
  createTerminalNodeAtFlowPosition,
} from './useInteractions.paneNodeCreation'
import { focusNodeInViewport } from '../helpers'
import { useWorkspaceCanvasShortcuts } from './useShortcuts'
import {
  resolveCanvasVisualCenter,
  resolveNodeNavigationTargetId,
  resolveSpaceNavigationTargetId,
} from './useShortcuts.helpers'
import type { SpatialNavigationDirection } from './spatialNavigation'
import { useWorkspaceCanvasSelectNode } from './useSelectNode'

type SetNodes = (
  updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
  options?: { syncLayout?: boolean },
) => void

const DEFAULT_VIEWPORT_WIDTH = 1440
const DEFAULT_VIEWPORT_HEIGHT = 900

function escapeCssAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function resolveViewportRectInFlowCoordinates({
  reactFlow,
  canvas,
}: {
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  canvas: HTMLElement | null
}): { left: number; top: number; right: number; bottom: number } {
  const flowElement = canvas?.querySelector('.react-flow') ?? null
  if (flowElement instanceof HTMLElement) {
    const rect = flowElement.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      const topLeft = reactFlow.screenToFlowPosition({ x: rect.left, y: rect.top })
      const bottomRight = reactFlow.screenToFlowPosition({ x: rect.right, y: rect.bottom })

      return {
        left: Math.min(topLeft.x, bottomRight.x),
        top: Math.min(topLeft.y, bottomRight.y),
        right: Math.max(topLeft.x, bottomRight.x),
        bottom: Math.max(topLeft.y, bottomRight.y),
      }
    }
  }

  const viewport = reactFlow.getViewport()
  const zoom = Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1
  const left = -viewport.x / zoom
  const top = -viewport.y / zoom

  return {
    left,
    top,
    right: left + DEFAULT_VIEWPORT_WIDTH / zoom,
    bottom: top + DEFAULT_VIEWPORT_HEIGHT / zoom,
  }
}

function focusPrimaryNodeEditor(nodeId: string): boolean {
  if (typeof document === 'undefined') {
    return false
  }

  const escapedNodeId = escapeCssAttributeValue(nodeId)
  const nodeElement = document.querySelector(
    `.workspace-canvas .react-flow__node[data-id="${escapedNodeId}"]`,
  )

  if (!(nodeElement instanceof HTMLElement)) {
    return false
  }

  if (!nodeElement.classList.contains('selected')) {
    return false
  }

  const focusTargetSelectors = [
    '.terminal-node__terminal .xterm-helper-textarea',
    '[data-testid="task-node-inline-requirement-input"]',
    '[data-testid="note-node-textarea"]',
    '[data-testid="document-node-textarea"]',
    'textarea, input, [contenteditable="true"]',
  ] as const

  for (const selector of focusTargetSelectors) {
    const target = nodeElement.querySelector(selector)
    if (!(target instanceof HTMLElement)) {
      continue
    }

    target.focus({ preventScroll: true })
    return true
  }

  return false
}

function schedulePrimaryNodeEditorFocus(nodeId: string): void {
  const schedule =
    typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0)

  schedule(() => {
    if (focusPrimaryNodeEditor(nodeId)) {
      return
    }

    setTimeout(() => {
      focusPrimaryNodeEditor(nodeId)
    }, 50)
  })
}

export function useWorkspaceCanvasShortcutActions({
  enabled,
  workspaceId,
  activeSpaceId,
  spaces,
  agentSettings,
  workspacePath,
  environmentVariables,
  canvasRef,
  setContextMenu,
  setEmptySelectionPrompt,
  cancelSpaceRename,
  reactFlow,
  spacesRef,
  spaceNavigationAnchorIdRef,
  nodesRef,
  setNodes,
  setSelectedNodeIds,
  setSelectedSpaceIds,
  selectedNodeIdsRef,
  selectedSpaceIdsRef,
  onSpacesChange,
  createNodeForSession,
  createNoteNode,
  createSpaceFromSelectedNodes,
  activateSpace,
  setActiveSpaceIdFromNodeNavigation,
  clearNodeSelection,
  onShowMessage,
}: {
  enabled: boolean
  workspaceId: string
  activeSpaceId: string | null
  spaces: WorkspaceSpaceState[]
  agentSettings: Pick<
    AgentSettings,
    | 'defaultTerminalProfileId'
    | 'disableAppShortcutsWhenTerminalFocused'
    | 'keybindings'
    | 'focusNodeTargetZoom'
    | 'standardWindowSizeBucket'
    | 'terminalFontSize'
  >
  workspacePath: string
  environmentVariables?: Record<string, string>
  canvasRef: React.RefObject<HTMLDivElement | null>
  setContextMenu: React.Dispatch<React.SetStateAction<import('../types').ContextMenuState | null>>
  setEmptySelectionPrompt: React.Dispatch<
    React.SetStateAction<import('../types').EmptySelectionPromptState | null>
  >
  cancelSpaceRename: () => void
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  spaceNavigationAnchorIdRef: React.MutableRefObject<string | null>
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: SetNodes
  setSelectedNodeIds: React.Dispatch<React.SetStateAction<string[]>>
  setSelectedSpaceIds: React.Dispatch<React.SetStateAction<string[]>>
  selectedNodeIdsRef: React.MutableRefObject<string[]>
  selectedSpaceIdsRef: React.MutableRefObject<string[]>
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  createNodeForSession: (input: CreateNodeInput) => Promise<Node<TerminalNodeData> | null>
  createNoteNode: (anchor: { x: number; y: number }) => Node<TerminalNodeData> | null
  createSpaceFromSelectedNodes: () => void
  activateSpace: (spaceId: string) => void
  setActiveSpaceIdFromNodeNavigation: (spaceId: string | null) => void
  clearNodeSelection: () => void
  onShowMessage?: (message: string, level: 'info' | 'warning' | 'error') => void
}): void {
  const selectNode = useWorkspaceCanvasSelectNode({
    setNodes,
    setSelectedNodeIds,
    setSelectedSpaceIds,
    selectedNodeIdsRef,
    selectedSpaceIdsRef,
    spacesRef,
  })

  const createNoteAtViewportCenter = useCallback((): void => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const clientPoint = resolveCanvasVisualCenter(canvas.getBoundingClientRect())
    const anchor = reactFlow.screenToFlowPosition(clientPoint)

    setContextMenu(null)
    setEmptySelectionPrompt(null)
    cancelSpaceRename()

    createNoteNodeAtFlowPosition({
      anchor,
      standardWindowSizeBucket: agentSettings.standardWindowSizeBucket,
      createNoteNode,
      spacesRef,
      nodesRef,
      setNodes,
      onSpacesChange,
    })
  }, [
    agentSettings.standardWindowSizeBucket,
    cancelSpaceRename,
    canvasRef,
    createNoteNode,
    nodesRef,
    onSpacesChange,
    reactFlow,
    setContextMenu,
    setEmptySelectionPrompt,
    setNodes,
    spacesRef,
  ])

  const createTerminalAtViewportCenter = useCallback(async (): Promise<void> => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const clientPoint = resolveCanvasVisualCenter(canvas.getBoundingClientRect())
    const anchor = reactFlow.screenToFlowPosition(clientPoint)

    setContextMenu(null)
    setEmptySelectionPrompt(null)
    cancelSpaceRename()

    await createTerminalNodeAtFlowPosition({
      anchor,
      workspaceId,
      defaultTerminalProfileId: agentSettings.defaultTerminalProfileId,
      standardWindowSizeBucket: agentSettings.standardWindowSizeBucket,
      terminalFontSize: agentSettings.terminalFontSize,
      workspacePath,
      environmentVariables,
      spacesRef,
      nodesRef,
      setNodes,
      onSpacesChange,
      createNodeForSession,
      onShowMessage,
    })
  }, [
    agentSettings.defaultTerminalProfileId,
    agentSettings.standardWindowSizeBucket,
    agentSettings.terminalFontSize,
    cancelSpaceRename,
    canvasRef,
    createNodeForSession,
    environmentVariables,
    nodesRef,
    onSpacesChange,
    reactFlow,
    setContextMenu,
    setEmptySelectionPrompt,
    setNodes,
    spacesRef,
    workspacePath,
    workspaceId,
    onShowMessage,
  ])

  const navigateNode = useCallback(
    (direction: SpatialNavigationDirection): void => {
      setContextMenu(null)
      setEmptySelectionPrompt(null)
      cancelSpaceRename()

      const canvas = canvasRef.current
      const viewportRect = resolveViewportRectInFlowCoordinates({ reactFlow, canvas })
      const sourceNodeId = selectedNodeIdsRef.current[0] ?? null
      const nodes = nodesRef.current.filter(node => node.hidden !== true)
      const resolvedSpaces = spacesRef.current

      const resolvedTarget = resolveNodeNavigationTargetId({
        direction,
        sourceNodeId,
        nodes,
        spaces: resolvedSpaces,
        viewportRect,
      })

      if (!resolvedTarget) {
        return
      }

      const targetNode = nodes.find(node => node.id === resolvedTarget.targetNodeId) ?? null
      if (!targetNode) {
        return
      }

      const desiredSpaceId = resolvedTarget.targetSpaceId
      if (desiredSpaceId !== activeSpaceId) {
        setActiveSpaceIdFromNodeNavigation(desiredSpaceId)
      }

      selectNode(resolvedTarget.targetNodeId)
      focusNodeInViewport(reactFlow, targetNode, {
        duration: 220,
        zoom: agentSettings.focusNodeTargetZoom,
      })
      schedulePrimaryNodeEditorFocus(resolvedTarget.targetNodeId)
    },
    [
      activeSpaceId,
      agentSettings.focusNodeTargetZoom,
      cancelSpaceRename,
      canvasRef,
      nodesRef,
      reactFlow,
      selectNode,
      selectedNodeIdsRef,
      setContextMenu,
      setEmptySelectionPrompt,
      setActiveSpaceIdFromNodeNavigation,
      spacesRef,
    ],
  )

  const navigateSpace = useCallback(
    (direction: SpatialNavigationDirection): void => {
      setContextMenu(null)
      setEmptySelectionPrompt(null)
      cancelSpaceRename()

      const canvas = canvasRef.current
      const viewportRect = resolveViewportRectInFlowCoordinates({ reactFlow, canvas })
      const sourceNodeId = selectedNodeIdsRef.current[0] ?? null

      const targetSpaceId = resolveSpaceNavigationTargetId({
        direction,
        sourceNodeId,
        spaceNavigationAnchorId: spaceNavigationAnchorIdRef.current,
        spaces: spacesRef.current,
        viewportRect,
      })

      if (!targetSpaceId) {
        return
      }

      clearNodeSelection()
      if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
      activateSpace(targetSpaceId)
      spaceNavigationAnchorIdRef.current = targetSpaceId
      canvasRef.current?.focus?.({ preventScroll: true })
    },
    [
      activateSpace,
      cancelSpaceRename,
      canvasRef,
      clearNodeSelection,
      reactFlow,
      selectedNodeIdsRef,
      setContextMenu,
      setEmptySelectionPrompt,
      spaceNavigationAnchorIdRef,
      spacesRef,
    ],
  )

  useWorkspaceCanvasShortcuts({
    enabled,
    platform:
      typeof window !== 'undefined' && window.opencoveApi?.meta?.platform
        ? window.opencoveApi.meta.platform
        : undefined,
    disableWhenTerminalFocused: agentSettings.disableAppShortcutsWhenTerminalFocused,
    keybindings: agentSettings.keybindings,
    activeSpaceId,
    spaces,
    nodesRef,
    createSpaceFromSelectedNodes,
    createNoteAtViewportCenter,
    createTerminalAtViewportCenter,
    activateSpace,
    navigateNode,
    navigateSpace,
  })
}
