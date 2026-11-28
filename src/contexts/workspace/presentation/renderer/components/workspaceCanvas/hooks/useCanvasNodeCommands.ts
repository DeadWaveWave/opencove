import { useMemo } from 'react'
import type { Node, ReactFlowInstance } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'
import type { WorkspaceCanvasProps } from '../types'
import type {
  CanvasNoteCommands,
  CanvasNodeCommands,
  CanvasRoleCommands,
  CanvasTaskCommands,
  CanvasTerminalCommands,
  CanvasWebsiteCommands,
  CanvasWindowCommands,
} from '../nodeCommands'
import { useCanvasFocusForInteraction } from './useCanvasFocusForInteraction'

/**
 * Composes the canvas's node commands (S7 of #647) from the functions that implement them, taken by
 * name. Each family is memoised on its functions and the whole object on its families, so a node
 * component that reads it renders again only when a command is made again: with the workspace
 * (its path or environment), the language, or the host's message callback. React Flow's viewport
 * initializing is not one of them.
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
  updateScrollback,
  recordCommandRun,
  clearAgentOverlay,
  renameTerminalTitle,
  copyLastAgentMessage,
  reloadAgentSession,
  listAgentSessions,
  switchAgentSession,
  updateNoteText,
  renameNoteTitle,
  convertNoteToTask,
  updateWebsiteUrl,
  setWebsitePinned,
  setWebsiteSession,
  setWebsiteMode,
  setWebsiteFullscreen,
  updateRoleInput,
  updateRoleProvider,
  runRole,
  runTaskAgent,
  resumeTaskAgentSession,
  removeTaskAgentSessionRecord,
  openTaskEditor,
  updateTaskTitle,
  updateTaskRequirement,
  updateTaskStatus,
}: {
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>>
  readAgentSettings: WorkspaceCanvasProps['readAgentSettings']
  selectNode: CanvasWindowCommands['select']
  clearNodeSelection: CanvasWindowCommands['clearSelection']
  requestNodeClose: CanvasWindowCommands['close']
  requestNodeDelete: CanvasWindowCommands['requestDelete']
  resizeNode: CanvasWindowCommands['resize']
  setNodeLabelColorOverride: CanvasWindowCommands['setLabelColorOverride']
  updateScrollback: CanvasTerminalCommands['updateScrollback']
  recordCommandRun: CanvasTerminalCommands['recordCommandRun']
  clearAgentOverlay: CanvasTerminalCommands['clearAgentOverlay']
  renameTerminalTitle: CanvasTerminalCommands['renameTitle']
  copyLastAgentMessage: CanvasTerminalCommands['copyLastAgentMessage']
  reloadAgentSession: CanvasTerminalCommands['reloadAgentSession']
  listAgentSessions: CanvasTerminalCommands['listAgentSessions']
  switchAgentSession: CanvasTerminalCommands['switchAgentSession']
  updateNoteText: CanvasNoteCommands['updateText']
  renameNoteTitle: CanvasNoteCommands['renameTitle']
  convertNoteToTask: CanvasNoteCommands['convertToTask']
  updateWebsiteUrl: CanvasWebsiteCommands['updateUrl']
  setWebsitePinned: CanvasWebsiteCommands['setPinned']
  setWebsiteSession: CanvasWebsiteCommands['setSession']
  setWebsiteMode: CanvasWebsiteCommands['setMode']
  setWebsiteFullscreen: CanvasWebsiteCommands['setFullscreen']
  updateRoleInput: CanvasRoleCommands['updateInput']
  updateRoleProvider: CanvasRoleCommands['updateProvider']
  runRole: CanvasRoleCommands['run']
  runTaskAgent: CanvasTaskCommands['runAgent']
  resumeTaskAgentSession: CanvasTaskCommands['resumeAgentSession']
  removeTaskAgentSessionRecord: CanvasTaskCommands['removeAgentSessionRecord']
  openTaskEditor: CanvasTaskCommands['openEditor']
  updateTaskTitle: CanvasTaskCommands['updateTitle']
  updateTaskRequirement: CanvasTaskCommands['updateRequirement']
  updateTaskStatus: CanvasTaskCommands['updateStatus']
}): CanvasNodeCommands {
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
  const terminal = useMemo<CanvasTerminalCommands>(
    () => ({
      updateScrollback,
      recordCommandRun,
      clearAgentOverlay,
      renameTitle: renameTerminalTitle,
      copyLastAgentMessage,
      reloadAgentSession,
      listAgentSessions,
      switchAgentSession,
    }),
    [
      clearAgentOverlay,
      copyLastAgentMessage,
      listAgentSessions,
      recordCommandRun,
      reloadAgentSession,
      renameTerminalTitle,
      switchAgentSession,
      updateScrollback,
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

  const role = useMemo<CanvasRoleCommands>(
    () => ({ updateInput: updateRoleInput, updateProvider: updateRoleProvider, run: runRole }),
    [runRole, updateRoleInput, updateRoleProvider],
  )

  const task = useMemo<CanvasTaskCommands>(
    () => ({
      runAgent: runTaskAgent,
      resumeAgentSession: resumeTaskAgentSession,
      removeAgentSessionRecord: removeTaskAgentSessionRecord,
      openEditor: openTaskEditor,
      updateTitle: updateTaskTitle,
      updateRequirement: updateTaskRequirement,
      updateStatus: updateTaskStatus,
    }),
    [
      openTaskEditor,
      removeTaskAgentSessionRecord,
      resumeTaskAgentSession,
      runTaskAgent,
      updateTaskRequirement,
      updateTaskStatus,
      updateTaskTitle,
    ],
  )

  return useMemo(
    () => ({ window: windowCommands, terminal, note, website, role, task }),
    [note, role, task, terminal, website, windowCommands],
  )
}
