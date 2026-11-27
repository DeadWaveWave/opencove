import { useMemo } from 'react'
import type { Node, ReactFlowInstance } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'
import type { WorkspaceCanvasProps } from '../types'
import type {
  CanvasNoteCommands,
  CanvasWebsiteCommands,
  CanvasWindowCommands,
  WiredCanvasNodeCommands,
} from '../nodeCommands'
import { useCanvasFocusForInteraction } from './useCanvasFocusForInteraction'

/**
 * Composes the canvas's node commands (S7 of #647) from the functions that implement them, taken by
 * name. Each family is memoised on its functions and the whole object on its families, so a node
 * component that reads it renders again only when a command is made again: with the workspace,
 * the language, the host's message callback, or once when React Flow's viewport initializes.
 * Nothing here closes over the document, the selection, the app settings or a node: each
 * implementation reads its owner when it runs.
 */
export function useComposedCanvasNodeCommands({
  reactFlow,
  readAgentSettings,
  selectNode,
  clearNodeSelection,
  requestNodeClose,
  requestNodeDelete,
  resizeNode,
  setNodeLabelColorOverride,
  updateNoteText,
  renameNoteTitle,
  convertNoteToTask,
  updateWebsiteUrl,
  setWebsitePinned,
  setWebsiteSession,
  setWebsiteMode,
  setWebsiteFullscreen,
}: {
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>>
  readAgentSettings: WorkspaceCanvasProps['readAgentSettings']
  selectNode: CanvasWindowCommands['select']
  clearNodeSelection: CanvasWindowCommands['clearSelection']
  requestNodeClose: CanvasWindowCommands['close']
  requestNodeDelete: CanvasWindowCommands['requestDelete']
  resizeNode: CanvasWindowCommands['resize']
  setNodeLabelColorOverride: CanvasWindowCommands['setLabelColorOverride']
  updateNoteText: CanvasNoteCommands['updateText']
  renameNoteTitle: CanvasNoteCommands['renameTitle']
  convertNoteToTask: CanvasNoteCommands['convertToTask']
  updateWebsiteUrl: CanvasWebsiteCommands['updateUrl']
  setWebsitePinned: CanvasWebsiteCommands['setPinned']
  setWebsiteSession: CanvasWebsiteCommands['setSession']
  setWebsiteMode: CanvasWebsiteCommands['setMode']
  setWebsiteFullscreen: CanvasWebsiteCommands['setFullscreen']
}): WiredCanvasNodeCommands {
  const focusForInteraction = useCanvasFocusForInteraction({ reactFlow, readAgentSettings })

  const windowCommands = useMemo<CanvasWindowCommands>(
    () => ({
      select: selectNode,
      clearSelection: clearNodeSelection,
      close: requestNodeClose,
      requestDelete: requestNodeDelete,
      resize: resizeNode,
      focusForInteraction,
      setLabelColorOverride: setNodeLabelColorOverride,
    }),
    [
      clearNodeSelection,
      focusForInteraction,
      requestNodeClose,
      requestNodeDelete,
      resizeNode,
      selectNode,
      setNodeLabelColorOverride,
    ],
  )
  const note = useMemo<CanvasNoteCommands>(
    () => ({
      updateText: updateNoteText,
      renameTitle: renameNoteTitle,
      convertToTask: convertNoteToTask,
    }),
    [convertNoteToTask, renameNoteTitle, updateNoteText],
  )
  const website = useMemo<CanvasWebsiteCommands>(
    () => ({
      updateUrl: updateWebsiteUrl,
      setPinned: setWebsitePinned,
      setSession: setWebsiteSession,
      setMode: setWebsiteMode,
      setFullscreen: setWebsiteFullscreen,
    }),
    [setWebsiteFullscreen, setWebsiteMode, setWebsitePinned, setWebsiteSession, updateWebsiteUrl],
  )

  return useMemo(() => ({ window: windowCommands, note, website }), [note, website, windowCommands])
}
