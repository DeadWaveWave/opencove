import { useCallback } from 'react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { CreateNodeInput } from '../types'
import {
  createNoteNodeAtFlowPosition,
  createTerminalNodeAtFlowPosition,
} from './useInteractions.paneNodeCreation'
import { useWorkspaceCanvasShortcuts } from './useShortcuts'
import { resolveCanvasVisualCenter } from './useShortcuts.helpers'

type SetNodes = (
  updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
  options?: { syncLayout?: boolean },
) => void

export function useWorkspaceCanvasShortcutActions({
  enabled,
  workspaceId,
  activeSpaceId,
  spaces,
  agentSettings,
  workspacePath,
  canvasRef,
  setContextMenu,
  setEmptySelectionPrompt,
  cancelSpaceRename,
  reactFlow,
  spacesRef,
  nodesRef,
  setNodes,
  onSpacesChange,
  createNodeForSession,
  createNoteNode,
  createSpaceFromSelectedNodes,
  activateSpace,
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
    | 'standardWindowSizeBucket'
  >
  workspacePath: string
  canvasRef: React.RefObject<HTMLDivElement | null>
  setContextMenu: React.Dispatch<React.SetStateAction<import('../types').ContextMenuState | null>>
  setEmptySelectionPrompt: React.Dispatch<
    React.SetStateAction<import('../types').EmptySelectionPromptState | null>
  >
  cancelSpaceRename: () => void
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: SetNodes
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  createNodeForSession: (input: CreateNodeInput) => Promise<Node<TerminalNodeData> | null>
  createNoteNode: (anchor: { x: number; y: number }) => Node<TerminalNodeData> | null
  createSpaceFromSelectedNodes: () => void
  activateSpace: (spaceId: string) => void
  onShowMessage?: (message: string, level: 'info' | 'warning' | 'error') => void
}): void {
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
      workspacePath,
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
    cancelSpaceRename,
    canvasRef,
    createNodeForSession,
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
  })
}
