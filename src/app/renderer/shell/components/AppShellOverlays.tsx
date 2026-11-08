import React, { useEffect } from 'react'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import type { FloatingMessageState } from '../hooks/useFloatingMessage'
import type { AgentNotificationTarget } from '../hooks/useAgentStandbyNotifications'
import { AppMessage } from './AppMessage'
import { AppNotifications, type AppNotification } from './AppNotifications'
import { ControlCenter } from './ControlCenter'
import { formatKeyChord, resolveCommandKeybinding } from '@contexts/settings/domain/keybindings'
import type { SettingsPageId } from '@contexts/settings/presentation/renderer/SettingsPanel.shared'

type SetStateAction<T> = T | ((prev: T) => T)

export function AppShellOverlays({
  floatingMessage,
  notifications,
  dismissNotification,
  resolveSystemNotificationTarget,
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
  /** The Agent a clicked system notification names, while it is still known. */
  resolveSystemNotificationTarget: (id: string) => AgentNotificationTarget | null
  onFocusAgentNode: (workspaceId: string, nodeId: string) => void
  agentSettings: AgentSettings
  setAgentSettings: (action: SetStateAction<AgentSettings>) => void
  activeWorkspace: WorkspaceState | null
  isControlCenterOpen: boolean
  controlCenterAnchorRef: React.RefObject<HTMLButtonElement | null>
  onCloseControlCenter: () => void
  onMinimapVisibilityChange: (isVisible: boolean) => void
  /** Opens Settings at a page, or where it was left. */
  onOpenSettings: (pageId?: SettingsPageId | null) => void
}): React.JSX.Element {
  // A clicked system notification jumps exactly like a clicked card.
  useEffect(
    () =>
      window.opencoveApi?.system?.onNotificationActivated?.(({ id }) => {
        const target = resolveSystemNotificationTarget(id)
        if (target) {
          dismissNotification(target.id)
          onFocusAgentNode(target.workspaceId, target.nodeId)
        }
      }),
    [dismissNotification, onFocusAgentNode, resolveSystemNotificationTarget],
  )

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
        hasActiveWorkspace={activeWorkspace !== null}
        inAppNotificationsEnabled={agentSettings.standbyBannerEnabled}
        systemNotificationsEnabled={agentSettings.systemNotificationsEnabled}
        soundEnabled={agentSettings.notificationSoundEnabled}
        settingsShortcut={formatKeyChord(
          window.opencoveApi?.meta?.platform,
          resolveCommandKeybinding({
            commandId: 'app.openSettings',
            overrides: agentSettings.keybindings,
            platform: window.opencoveApi?.meta?.platform,
          }),
        )}
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
        onChangeInAppNotifications={enabled => {
          setAgentSettings(prev => ({ ...prev, standbyBannerEnabled: enabled }))
        }}
        onChangeSystemNotifications={enabled => {
          setAgentSettings(prev => ({ ...prev, systemNotificationsEnabled: enabled }))
        }}
        onChangeSound={enabled => {
          setAgentSettings(prev => ({ ...prev, notificationSoundEnabled: enabled }))
        }}
        onOpenSettings={onOpenSettings}
      />
    </>
  )
}
