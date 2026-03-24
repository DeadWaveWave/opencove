import React from 'react'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import type { FloatingMessageState } from '../hooks/useFloatingMessage'
import { AppMessage } from './AppMessage'
import { AppNotifications, type AppNotification } from './AppNotifications'
import { ControlCenter } from './ControlCenter'

type SetStateAction<T> = T | ((prev: T) => T)

export function AppShellOverlays({
  floatingMessage,
  notifications,
  dismissNotification,
  onFocusAgentNode,
  agentSettings,
  setAgentSettings,
  activeWorkspace,
  isPrimarySidebarCollapsed,
  isControlCenterOpen,
  onCloseControlCenter,
  onMinimapVisibilityChange,
  onOpenSettings,
}: {
  floatingMessage: FloatingMessageState
  notifications: AppNotification[]
  dismissNotification: (id: string) => void
  onFocusAgentNode: (workspaceId: string, nodeId: string) => void
  agentSettings: AgentSettings
  setAgentSettings: (action: SetStateAction<AgentSettings>) => void
  activeWorkspace: WorkspaceState | null
  isPrimarySidebarCollapsed: boolean
  isControlCenterOpen: boolean
  onCloseControlCenter: () => void
  onMinimapVisibilityChange: (isVisible: boolean) => void
  onOpenSettings: () => void
}): React.JSX.Element {
  return (
    <>
      {floatingMessage ? (
        <AppMessage tone={floatingMessage.tone} text={floatingMessage.text} />
      ) : null}

      <AppNotifications
        notifications={notifications}
        contextVisibility={{
          showTask: agentSettings.standbyBannerShowTask,
          showSpace: agentSettings.standbyBannerShowSpace,
          showBranch: agentSettings.standbyBannerShowBranch,
          showPullRequest:
            agentSettings.standbyBannerShowPullRequest && agentSettings.githubPullRequestsEnabled,
        }}
        onActivate={notification => {
          dismissNotification(notification.id)
          onFocusAgentNode(notification.workspaceId, notification.nodeId)
        }}
        onDismiss={dismissNotification}
      />

      <ControlCenter
        isOpen={isControlCenterOpen}
        uiTheme={agentSettings.uiTheme}
        isPrimarySidebarCollapsed={isPrimarySidebarCollapsed}
        isMinimapVisible={activeWorkspace?.isMinimapVisible ?? false}
        isStandbyBannerEnabled={agentSettings.standbyBannerEnabled}
        hasActiveWorkspace={activeWorkspace !== null}
        onClose={() => {
          onCloseControlCenter()
        }}
        onChangeUiTheme={theme => {
          setAgentSettings(prev => ({
            ...prev,
            uiTheme: theme,
          }))
        }}
        onTogglePrimarySidebar={() => {
          setAgentSettings(prev => ({
            ...prev,
            isPrimarySidebarCollapsed: !prev.isPrimarySidebarCollapsed,
          }))
        }}
        onToggleMinimap={() => {
          if (!activeWorkspace) {
            return
          }

          onMinimapVisibilityChange(!activeWorkspace.isMinimapVisible)
        }}
        onToggleStandbyBanner={() => {
          setAgentSettings(prev => ({
            ...prev,
            standbyBannerEnabled: !prev.standbyBannerEnabled,
          }))
        }}
        onOpenSettings={() => {
          onOpenSettings()
        }}
      />
    </>
  )
}
