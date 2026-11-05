import React from 'react'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import type { FloatingMessageState } from '../hooks/useFloatingMessage'
import { AppMessage } from './AppMessage'
import { AppNotifications, type AppNotification } from './AppNotifications'
import { ControlCenter } from './ControlCenter'
import { formatKeyChord, resolveCommandKeybinding } from '@contexts/settings/domain/keybindings'

type SetStateAction<T> = T | ((prev: T) => T)

export function AppShellOverlays({
  floatingMessage,
  notifications,
  dismissNotification,
  onFocusAgentNode,
  agentSettings,
  setAgentSettings,
  activeWorkspace,
  isControlCenterOpen,
  controlCenterAnchorRef,
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
  isControlCenterOpen: boolean
  controlCenterAnchorRef: React.RefObject<HTMLButtonElement | null>
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
        anchorRef={controlCenterAnchorRef}
        uiTheme={agentSettings.uiTheme}
        isMinimapVisible={activeWorkspace?.isMinimapVisible ?? false}
        backgroundStyle={agentSettings.canvasBackgroundStyle}
        isBackgroundTwinkleEnabled={agentSettings.canvasBackgroundTwinkleEnabled}
        areMotionSignalsEnabled={
          agentSettings.nodeCreationPixelEffectEnabled &&
          agentSettings.nodeClosePixelEffectEnabled &&
          agentSettings.agentWorkingPixelEffectEnabled
        }
        hasActiveWorkspace={activeWorkspace !== null}
        windowMaterial={agentSettings.windowMaterial}
        settingsShortcut={formatKeyChord(
          window.opencoveApi?.meta?.platform,
          resolveCommandKeybinding({
            commandId: 'app.openSettings',
            overrides: agentSettings.keybindings,
            platform: window.opencoveApi?.meta?.platform,
          }),
        )}
        onChangeWindowMaterial={material => {
          setAgentSettings(prev => ({ ...prev, windowMaterial: material }))
        }}
        onClose={() => {
          onCloseControlCenter()
        }}
        onChangeUiTheme={theme => {
          setAgentSettings(prev => ({
            ...prev,
            uiTheme: theme,
          }))
        }}
        onToggleMinimap={() => {
          if (!activeWorkspace) {
            return
          }

          onMinimapVisibilityChange(!activeWorkspace.isMinimapVisible)
        }}
        onChangeBackgroundStyle={style => {
          setAgentSettings(prev => ({ ...prev, canvasBackgroundStyle: style }))
        }}
        onChangeBackgroundTwinkle={enabled => {
          setAgentSettings(prev => ({ ...prev, canvasBackgroundTwinkleEnabled: enabled }))
        }}
        onChangeMotionSignals={enabled => {
          setAgentSettings(prev => ({
            ...prev,
            nodeCreationPixelEffectEnabled: enabled,
            nodeClosePixelEffectEnabled: enabled,
            agentWorkingPixelEffectEnabled: enabled,
          }))
        }}
        onOpenSettings={() => {
          onOpenSettings()
        }}
      />
    </>
  )
}
