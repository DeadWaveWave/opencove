import React, { useLayoutEffect, useRef } from 'react'
import { acquireInertRootLease } from '@app/renderer/components/ui/inertRootLease'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { TerminalClientDisplayCalibration } from '@contexts/settings/domain/terminalDisplayCalibration'
import { WorkspaceCanvas } from '@contexts/workspace/presentation/renderer/components/WorkspaceCanvas'
import type { WorkspaceCanvasMessageTone } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/types'
import type {
  SpaceArchiveRecord,
  WorkspaceState,
  WorkspaceViewport,
} from '@contexts/workspace/presentation/renderer/types'
import type { FocusRequest, ProjectContextMenuState } from '../types'
import { WorkspaceEmptyState } from './WorkspaceEmptyState'

function WorkspaceMainComponent({
  activeWorkspace,
  agentSettings,
  terminalDisplayCalibration,
  focusRequest,
  isFocusNodeTargetZoomPreviewing,
  isSettingsPageOpen = false,
  shortcutsEnabled,
  onAddWorkspace,
  onShowMessage,
  onRequestPersistFlush,
  onAppendSpaceArchiveRecord,
  onNodesChange,
  onViewportChange,
  onMinimapVisibilityChange,
  onChangePreserveWindowSizesOnArrange,
  onSpacesChange,
  onActiveSpaceChange,
  onOpenProjectContextMenu,
}: {
  activeWorkspace: WorkspaceState | null
  agentSettings: AgentSettings
  terminalDisplayCalibration: TerminalClientDisplayCalibration | null
  focusRequest: FocusRequest | null
  isFocusNodeTargetZoomPreviewing: boolean
  isSettingsPageOpen?: boolean
  shortcutsEnabled: boolean
  onAddWorkspace: () => void
  onShowMessage: (message: string, tone?: WorkspaceCanvasMessageTone) => void
  onRequestPersistFlush: () => void
  onAppendSpaceArchiveRecord: (record: SpaceArchiveRecord) => void
  onNodesChange: (nodes: WorkspaceState['nodes']) => void
  onViewportChange: (viewport: WorkspaceViewport) => void
  onMinimapVisibilityChange: (isVisible: boolean) => void
  onChangePreserveWindowSizesOnArrange: (enabled: boolean) => void
  onSpacesChange: (spaces: WorkspaceState['spaces']) => void
  onActiveSpaceChange: (spaceId: string | null) => void
  onOpenProjectContextMenu: (state: ProjectContextMenuState) => void
}): React.JSX.Element {
  const surfaceRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (isSettingsPageOpen && surfaceRef.current) {
      return acquireInertRootLease(surfaceRef.current)
    }
    return undefined
  }, [isSettingsPageOpen])
  const surfaceProps = {
    ref: surfaceRef,
    className: `workspace-main${isSettingsPageOpen && !isFocusNodeTargetZoomPreviewing ? ' workspace-main--covered' : ''}`,
    'aria-hidden': isSettingsPageOpen || undefined,
  }
  if (!activeWorkspace) {
    return (
      <main {...surfaceProps}>
        <WorkspaceEmptyState onAddWorkspace={onAddWorkspace} />
      </main>
    )
  }

  const activeFocusRequest =
    focusRequest && focusRequest.workspaceId === activeWorkspace.id ? focusRequest : null
  const focusNodeId = activeFocusRequest?.kind === 'node' ? activeFocusRequest.nodeId : null
  const focusNodeInput =
    activeFocusRequest?.kind === 'node' ? activeFocusRequest.focusInput : undefined
  const focusSpaceId = activeFocusRequest?.kind === 'space' ? activeFocusRequest.spaceId : null
  const focusSequence = activeFocusRequest?.sequence ?? 0

  return (
    <main {...surfaceProps}>
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
        onChangePreserveWindowSizesOnArrange={onChangePreserveWindowSizesOnArrange}
        spaces={activeWorkspace.spaces}
        activeSpaceId={activeWorkspace.activeSpaceId}
        onSpacesChange={onSpacesChange}
        onActiveSpaceChange={onActiveSpaceChange}
        onOpenSpaceContextMenu={(spaceId, anchor) => {
          onOpenProjectContextMenu({
            workspaceId: activeWorkspace.id,
            x: anchor.x,
            y: anchor.y,
            target: {
              kind: 'space',
              workspaceId: activeWorkspace.id,
              spaceId,
            },
          })
        }}
        shortcutsEnabled={shortcutsEnabled}
        agentSettings={agentSettings}
        terminalDisplayCalibration={terminalDisplayCalibration}
        isFocusNodeTargetZoomPreviewing={isFocusNodeTargetZoomPreviewing}
        focusNodeId={focusNodeId}
        focusNodeInput={focusNodeInput}
        focusSpaceId={focusSpaceId}
        focusSequence={focusSequence}
      />
    </main>
  )
}

export const WorkspaceMain = React.memo(WorkspaceMainComponent)
