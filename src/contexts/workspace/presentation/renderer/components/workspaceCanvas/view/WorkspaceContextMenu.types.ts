import type {
  AgentProvider,
  QuickCommand,
  QuickPhrase,
} from '@contexts/settings/domain/agentSettings'
import type { NodeLabelColorOverride } from '@shared/types/labelColor'
import type { WorkspaceSpaceState } from '../../../types'
import type { ContextMenuState } from '../types'
import type { WorkspaceArrangeStyle } from '../../../utils/workspaceArrange'

export type OpenSubmenu =
  | 'arrangeBy'
  | 'agent-providers'
  | 'label-color'
  | 'quick-commands'
  | 'quick-phrases'
  | null

export interface WorkspaceContextMenuProps {
  contextMenu: ContextMenuState | null
  closeContextMenu: () => void
  createTerminalNode: () => Promise<void>
  createNoteNodeFromContextMenu: () => void
  createWebsiteNodeFromContextMenu: () => void
  websiteWindowsEnabled: boolean
  openTaskCreator: () => void
  openAgentLauncher: () => void
  agentProviderOrder: AgentProvider[]
  openAgentLauncherForProvider: (provider: AgentProvider) => void
  quickCommands: QuickCommand[]
  quickPhrases: QuickPhrase[]
  runQuickCommand: (command: QuickCommand) => Promise<void>
  insertQuickPhrase: (phrase: QuickPhrase) => void
  openQuickMenuSettings: () => void
  spaces: WorkspaceSpaceState[]
  magneticSnappingEnabled: boolean
  onToggleMagneticSnapping: () => void
  canArrangeAll: boolean
  canArrangeCanvas: boolean
  arrangeAll: (style?: WorkspaceArrangeStyle) => void
  arrangeCanvas: (style?: WorkspaceArrangeStyle) => void
  arrangeInSpace: (spaceId: string, style?: WorkspaceArrangeStyle) => void
  createSpaceFromSelectedNodes: () => void
  createEmptySpaceAtPoint: (point: { x: number; y: number }) => void
  clearNodeSelection: () => void
  canConvertSelectedNoteToTask: boolean
  isConvertSelectedNoteToTaskDisabled: boolean
  convertSelectedNoteToTask: () => void
  setSelectedNodeLabelColorOverride: (labelColorOverride: NodeLabelColorOverride) => void
}
