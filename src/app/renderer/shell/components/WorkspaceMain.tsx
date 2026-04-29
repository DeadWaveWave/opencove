import React from 'react'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import { WorkspaceCanvas } from '@contexts/workspace/presentation/renderer/components/WorkspaceCanvas'
import type { WorkspaceCanvasMessageTone } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/types'
import type {
  SpaceArchiveRecord,
  WorkspaceState,
  WorkspaceViewport,
} from '@contexts/workspace/presentation/renderer/types'
import type { FocusRequest } from '../types'
import { WorkspaceEmptyState } from './WorkspaceEmptyState'

function WorkspaceMainComponent({
  activeWorkspace,
  agentSettings,
  focusRequest,
  isFocusNodeTargetZoomPreviewing,
  shortcutsEnabled,
  onAddWorkspace,
  onShowMessage,
  onRequestPersistFlush,
  onAppendSpaceArchiveRecord,
  onNodesChange,
  onViewportChange,
  onMinimapVisibilityChange,
  onSpacesChange,
  onActiveSpaceChange,
}: {
  activeWorkspace: WorkspaceState | null
  agentSettings: AgentSettings
  focusRequest: FocusRequest | null
  isFocusNodeTargetZoomPreviewing: boolean
  shortcutsEnabled: boolean
  onAddWorkspace: () => void
  onShowMessage: (message: string, tone?: WorkspaceCanvasMessageTone) => void
  onRequestPersistFlush: () => void
  onAppendSpaceArchiveRecord: (record: SpaceArchiveRecord) => void
  onNodesChange: (nodes: WorkspaceState['nodes']) => void
  onViewportChange: (viewport: WorkspaceViewport) => void
  onMinimapVisibilityChange: (isVisible: boolean) => void
  onSpacesChange: (spaces: WorkspaceState['spaces']) => void
  onActiveSpaceChange: (spaceId: string | null) => void
}): React.JSX.Element {
  if (!activeWorkspace) {
    return (
      <main className="workspace-main">
        <WorkspaceEmptyState onAddWorkspace={onAddWorkspace} />
      </main>
    )
  }

  const activeFocusRequest =
    focusRequest && focusRequest.workspaceId === activeWorkspace.id ? focusRequest : null
  const focusNodeId = activeFocusRequest?.kind === 'node' ? activeFocusRequest.nodeId : null
  const focusSpaceId = activeFocusRequest?.kind === 'space' ? activeFocusRequest.spaceId : null
  const focusSequence = activeFocusRequest?.sequence ?? 0

  return (
    <main className="workspace-main">
      <WorkspaceCanvas
        workspaceId={activeWorkspace.id}
        onShowMessage={onShowMessage}
        workspacePath={activeWorkspace.path}
        environmentVariables={activeWorkspace.environmentVariables}
        worktreesRoot={activeWorkspace.worktreesRoot}
        nodes={activeWorkspace.nodes}
        onNodesChange={onNodesChange}
        onRequestPersistFlush={onRequestPersistFlush}
        onAppendSpaceArchiveRecord={onAppendSpaceArchiveRecord}
        viewport={activeWorkspace.viewport}
        isMinimapVisible={activeWorkspace.isMinimapVisible}
        onViewportChange={onViewportChange}
        onMinimapVisibilityChange={onMinimapVisibilityChange}
        spaces={activeWorkspace.spaces}
        activeSpaceId={activeWorkspace.activeSpaceId}
        onSpacesChange={onSpacesChange}
        onActiveSpaceChange={onActiveSpaceChange}
        shortcutsEnabled={shortcutsEnabled}
        agentSettings={agentSettings}
        isFocusNodeTargetZoomPreviewing={isFocusNodeTargetZoomPreviewing}
        focusNodeId={focusNodeId}
        focusSpaceId={focusSpaceId}
        focusSequence={focusSequence}
      />
    </main>
  )
}

export const WorkspaceMain = React.memo(WorkspaceMainComponent)
