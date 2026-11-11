import { createContext, useContext } from 'react'
import type { MutableRefObject } from 'react'
import type { BrowserMode, WebsiteWindowSessionMode } from '@shared/contracts/dto'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { BrowserSearchEngineId } from '@contexts/settings/domain/browserSettings'
import type { NodeLabelColorOverride } from '@shared/types/labelColor'
import type { NodeFrame, WorkspaceSpaceState } from '../../types'
import type {
  QuickUpdateTaskRequirement,
  QuickUpdateTaskTitle,
  ShowWorkspaceCanvasMessage,
  UpdateNodeScrollback,
  UpdateTaskStatus,
} from './types'
export interface WorkspaceCanvasNodeTypesParams {
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  workspacePath: string
  onShowMessage?: ShowWorkspaceCanvasMessage
  agentProviderOrder: AgentProvider[]
  defaultProvider: AgentProvider
  browserDefaultMode: BrowserMode
  browserSearchEngine: BrowserSearchEngineId
  selectNode: (nodeId: string, options?: { toggle?: boolean }) => void
  convertNoteToTask: (nodeId: string) => boolean
  setNodeLabelColorOverride: (nodeIds: string[], labelColorOverride: NodeLabelColorOverride) => void
  clearNodeSelectionRef: MutableRefObject<() => void>
  closeNodeRef: MutableRefObject<(nodeId: string) => Promise<void>>
  resizeNodeRef: MutableRefObject<(nodeId: string, desiredFrame: NodeFrame) => void>
  copyAgentLastMessageRef: MutableRefObject<(nodeId: string) => Promise<void>>
  reloadAgentSessionRef: MutableRefObject<(nodeId: string) => Promise<void>>
  listAgentSessionsRef: MutableRefObject<
    (
      nodeId: string,
      limit?: number,
    ) => Promise<import('@shared/contracts/dto').AgentSessionSummary[]>
  >
  switchAgentSessionRef: MutableRefObject<
    (nodeId: string, summary: import('@shared/contracts/dto').AgentSessionSummary) => Promise<void>
  >
  updateNoteTextRef: MutableRefObject<(nodeId: string, text: string) => void>
  renameNoteTitleRef: MutableRefObject<(nodeId: string, title: string) => void>
  updateRoleProviderRef: MutableRefObject<(nodeId: string, provider: AgentProvider) => void>
  updateRoleInputRef: MutableRefObject<(nodeId: string, input: string) => void>
  runRoleRef: MutableRefObject<(nodeId: string, inputOverride?: string) => Promise<void>>
  updateNodeScrollbackRef: MutableRefObject<UpdateNodeScrollback>
  normalizeViewportForTerminalInteractionRef: MutableRefObject<(nodeId: string) => void>
  requestNodeDeleteRef: MutableRefObject<(nodeIds: string[]) => void>
  openTaskEditorRef: MutableRefObject<(nodeId: string) => void>
  quickUpdateTaskTitleRef: MutableRefObject<QuickUpdateTaskTitle>
  quickUpdateTaskRequirementRef: MutableRefObject<QuickUpdateTaskRequirement>
  runTaskAgentRef: MutableRefObject<(nodeId: string) => Promise<void>>
  resumeTaskAgentSessionRef: MutableRefObject<
    (taskNodeId: string, recordId: string) => Promise<void>
  >
  removeTaskAgentSessionRecordRef: MutableRefObject<(taskNodeId: string, recordId: string) => void>
  updateTaskStatusRef: MutableRefObject<UpdateTaskStatus>
  updateTerminalTitleRef: MutableRefObject<
    (nodeId: string, title: string, startedAtMs?: number) => void
  >
  clearTerminalAgentOverlayRef: MutableRefObject<
    (nodeId: string, expectedStartedAtMs?: number) => void
  >
  renameTerminalTitleRef: MutableRefObject<(nodeId: string, title: string) => void>
  updateWebsiteUrlRef: MutableRefObject<(nodeId: string, url: string) => void>
  setWebsitePinnedRef: MutableRefObject<(nodeId: string, pinned: boolean) => void>
  setWebsiteSessionRef: MutableRefObject<
    (nodeId: string, sessionMode: WebsiteWindowSessionMode, profileId: string | null) => void
  >
  setWebsiteModeRef: MutableRefObject<(nodeId: string, browserMode: BrowserMode) => void>
  setWebsiteFullscreenRef: MutableRefObject<
    (
      nodeId: string,
      frame: NodeFrame,
      previousFrame: NodeFrame | null,
      isFullscreen: boolean,
    ) => void
  >
}

const Context = createContext<WorkspaceCanvasNodeTypesParams | null>(null)
export const WorkspaceCanvasNodeTypesProvider = Context.Provider
export function useWorkspaceCanvasNodeTypeParameters(): WorkspaceCanvasNodeTypesParams {
  const parameters = useContext(Context)
  if (!parameters) {
    throw new Error('Workspace canvas node parameters are missing.')
  }
  return parameters
}
