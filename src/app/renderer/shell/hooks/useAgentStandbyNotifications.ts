import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { AgentStandbyNotification } from '../utils/agentStandbyNotification'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { useAppStore } from '../store/useAppStore'
import {
  AGENT_ATTENTION_MAX_PENDING,
  useAgentAttentionStore,
} from '../store/useAgentAttentionStore'
import {
  createAgentAttentionRouter,
  type AgentAttentionEffect,
  type AgentAttentionRouter,
} from '../utils/agentAttentionRouter'
import { playNotificationSound } from '../utils/notificationSound'
import { useAgentStandbyNotificationGitContext } from './useAgentStandbyNotificationGitContext'
import {
  type AgentStandbyNotificationPayload,
  useAgentStandbyNotificationWatcher,
} from './useAgentStandbyNotificationWatcher'
import { useAgentStandbyNotificationTitleGate } from './useAgentStandbyNotificationTitleGate'

function resolveTaskTitle(workspace: WorkspaceState | null, taskId: string | null): string | null {
  if (!workspace || !taskId) {
    return null
  }

  const taskNode = workspace.nodes.find(node => node.id === taskId)
  if (!taskNode) {
    return null
  }

  return typeof taskNode.data?.title === 'string' && taskNode.data.title.trim().length > 0
    ? taskNode.data.title
    : null
}

function resolveOwningSpace(
  workspace: WorkspaceState | null,
  nodeId: string,
  taskId: string | null,
): { id: string; name: string; directoryPath: string } | null {
  if (!workspace) {
    return null
  }

  const match =
    workspace.spaces.find(space => space.nodeIds.includes(nodeId)) ??
    (taskId ? workspace.spaces.find(space => space.nodeIds.includes(taskId)) : null) ??
    null

  if (!match) {
    return null
  }

  return {
    id: match.id,
    name: match.name,
    directoryPath: match.directoryPath,
  }
}

export function formatAgentStandbySystemNotification(
  notification: Pick<
    AgentStandbyNotification,
    'title' | 'workspaceName' | 'taskTitle' | 'spaceName'
  >,
  labels: {
    standby: string
    task: string
    space: string
  },
): { title: string; body: string } {
  const summary = notification.workspaceName
    ? `${labels.standby} · ${notification.workspaceName}`
    : labels.standby
  const contextLines = [
    notification.taskTitle ? `${labels.task}: ${notification.taskTitle}` : null,
    notification.spaceName ? `${labels.space}: ${notification.spaceName}` : null,
  ].filter((line): line is string => !!line)

  return {
    title: notification.title,
    body: [summary, ...contextLines].join('\n'),
  }
}

/** One Agent reads as its own notification; Agents that needed you together read as a count. */
export function formatAgentAttentionSystemNotification(
  items: AgentStandbyNotification[],
  labels: { standby: string; task: string; space: string; summary: (count: number) => string },
): { title: string; body: string } {
  if (items.length === 1) {
    return formatAgentStandbySystemNotification(items[0], labels)
  }

  return {
    title: labels.summary(items.length),
    body: items.map(item => item.title).join(' · '),
  }
}

// System notifications whose click can still find their Agent.
const MAX_SYSTEM_NOTIFICATION_TARGETS = 20

export type AgentNotificationTarget = Pick<
  AgentStandbyNotification,
  'id' | 'workspaceId' | 'nodeId'
>

/** Mounted once by the shell: it routes each Agent that ends a turn into the attention store. */
export function useAgentStandbyNotifications(): {
  /** The Agents you have not answered, newest first. */
  notifications: AgentStandbyNotification[]
  dismiss: (id: string) => void
  /** The Agent a clicked system notification points at: the first one it names. */
  resolveSystemNotificationTarget: (id: string) => AgentNotificationTarget | null
} {
  const { t } = useTranslation()
  const platform = window.opencoveApi?.meta?.platform
  const workspaces = useAppStore(state => state.workspaces)
  const settings = useAppStore(state => state.agentSettings)
  const isStandbyBannerEnabled = settings.standbyBannerEnabled
  const isAnyChannelEnabled =
    isStandbyBannerEnabled ||
    settings.systemNotificationsEnabled ||
    settings.notificationSoundEnabled
  const showPullRequests =
    settings.standbyBannerShowPullRequest && settings.githubPullRequestsEnabled

  const notifications = useAgentAttentionStore(state => state.notifications)
  const setNotifications = useAgentAttentionStore(state => state.setNotifications)
  const dismiss = useAgentAttentionStore(state => state.dismiss)
  const workspacesById = useMemo(() => {
    return new Map(workspaces.map(workspace => [workspace.id, workspace]))
  }, [workspaces])

  const systemTargetsRef = useRef(new Map<string, AgentNotificationTarget>())
  // The router outlives renders; it reads the latest switches and effect handler through refs.
  const settingsRef = useRef(settings)
  const emit = useCallback(
    (effect: AgentAttentionEffect<AgentStandbyNotification>) => {
      switch (effect.kind) {
        case 'show-card':
          setNotifications(previous => {
            if (previous.some(notification => notification.id === effect.item.id)) {
              return previous
            }
            return [effect.item, ...previous].slice(0, AGENT_ATTENTION_MAX_PENDING)
          })
          return
        case 'clear-card':
          setNotifications(previous =>
            previous.filter(notification => notification.sessionId !== effect.sessionId),
          )
          return
        case 'play-sound':
          playNotificationSound(
            settingsRef.current.notificationSound,
            settingsRef.current.notificationSoundVolume,
          )
          return
        case 'system': {
          const targets = systemTargetsRef.current
          targets.set(effect.id, effect.items[0])
          if (targets.size > MAX_SYSTEM_NOTIFICATION_TARGETS) {
            targets.delete(targets.keys().next().value ?? '')
          }
          const text = formatAgentAttentionSystemNotification(effect.items, {
            standby: t('agentRuntime.standby'),
            task: t('settingsPanel.nav.tasks'),
            space: t('commandCenter.sections.spaces'),
            summary: count => t('agentAttention.systemSummary', { count }),
          })
          // Always silent: the app plays the one sound itself, in front or behind.
          void window.opencoveApi?.system
            ?.showNotification({
              ...text,
              silent: true,
              id: effect.id,
              replacesId: effect.replacesId,
            })
            .catch(() => undefined)
        }
      }
    },
    [setNotifications, t],
  )
  const emitRef = useRef(emit)
  useEffect(() => {
    settingsRef.current = settings
    emitRef.current = emit
  }, [emit, settings])

  const routerRef = useRef<AgentAttentionRouter<AgentStandbyNotification> | null>(null)
  useEffect(() => {
    const router = createAgentAttentionRouter<AgentStandbyNotification>({
      channels: () => ({
        inApp: settingsRef.current.standbyBannerEnabled,
        system: settingsRef.current.systemNotificationsEnabled,
        sound: settingsRef.current.notificationSoundEnabled,
      }),
      emit: effect => emitRef.current(effect),
    })
    routerRef.current = router
    return () => {
      router.dispose()
      routerRef.current = null
    }
  }, [])

  const publishAgentEnteredStandby = useCallback(
    (payload: AgentStandbyNotificationPayload) => {
      const workspace = workspacesById.get(payload.workspaceId) ?? null
      const space = resolveOwningSpace(workspace, payload.nodeId, payload.taskId)
      routerRef.current?.needsYou({
        kind: 'agent-standby',
        id: payload.sessionId,
        sessionId: payload.sessionId,
        workspaceId: payload.workspaceId,
        workspaceName: payload.workspaceName,
        workspacePath: payload.workspacePath,
        nodeId: payload.nodeId,
        title: payload.title,
        taskId: payload.taskId,
        taskTitle: resolveTaskTitle(workspace, payload.taskId),
        spaceId: space?.id ?? null,
        spaceName: space?.name ?? null,
        spaceDirectoryPath: space?.directoryPath ?? null,
        executionDirectory: payload.executionDirectory,
        gitContext: null,
        pullRequest: null,
        createdAt: Date.now(),
      })
    },
    [workspacesById],
  )

  const { deferUntilTitleReady: handleAgentEnteredStandby, cancelPendingTitle } =
    useAgentStandbyNotificationTitleGate({
      enabled: isAnyChannelEnabled,
      onReady: publishAgentEnteredStandby,
    })

  const handleAgentEnteredWorking = useCallback(
    (sessionId: string) => {
      cancelPendingTitle(sessionId)
      routerRef.current?.working(sessionId)
    },
    [cancelPendingTitle],
  )

  useEffect(() => {
    if (isStandbyBannerEnabled) {
      return
    }

    setNotifications([])
  }, [isStandbyBannerEnabled, setNotifications])

  const resolveSystemNotificationTarget = useCallback(
    (id: string) => systemTargetsRef.current.get(id) ?? null,
    [],
  )

  useAgentStandbyNotificationGitContext({
    notifications,
    setNotifications,
    platform,
    shouldResolveBranch:
      isStandbyBannerEnabled && (settings.standbyBannerShowBranch || showPullRequests),
    shouldResolvePullRequest: isStandbyBannerEnabled && showPullRequests,
  })

  useAgentStandbyNotificationWatcher({
    enabled: isAnyChannelEnabled,
    onAgentEnteredStandby: handleAgentEnteredStandby,
    onAgentEnteredWorking: handleAgentEnteredWorking,
  })

  return { notifications, dismiss, resolveSystemNotificationTarget }
}
