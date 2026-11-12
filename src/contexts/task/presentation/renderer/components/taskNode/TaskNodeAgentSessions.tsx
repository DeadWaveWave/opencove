import { useMemo, useState, type JSX, type MouseEvent } from 'react'
import { TrashIcon, UndoIcon } from '@app/renderer/components/ui/pixelIcons'
import { IconButton } from '@app/renderer/components/ui/IconButton'
import { MenuItem } from '@app/renderer/components/ui/Menu'
import { AgentProviderIcon } from '@app/renderer/components/AgentProviderIcon'
import { useTranslation } from '@app/renderer/i18n'
import { ViewportMenuSurface } from '@app/renderer/components/ViewportMenuSurface'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import { isResumeSessionBindingVerified } from '@contexts/agent/domain/agentResumeBinding'
import type {
  AgentRuntimeStatus,
  TaskAgentSessionRecord,
} from '@contexts/workspace/presentation/renderer/types'
import { providerLabel } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/helpers'
import {
  formatTaskTimestamp,
  getAgentRuntimeLabel,
  resolveAgentSessionTone,
  resolveSessionAvatarSlots,
} from './helpers'
import { TaskNodeResumeDialog } from './TaskNodeResumeDialog'

interface LinkedAgentSummary {
  nodeId: string
  title: string
  provider: AgentProvider
  status: AgentRuntimeStatus | null
  startedAt: string | null
}

/** One avatar: the Agent window the task is running in, or a past session's record. */
type SessionEntry =
  | {
      kind: 'linked'
      key: string
      provider: AgentProvider
      status: AgentRuntimeStatus | null
      timestamp: string | null
      description: string
      nodeId: string
    }
  | {
      kind: 'record'
      key: string
      provider: AgentProvider
      status: AgentRuntimeStatus | null
      timestamp: string | null
      description: string
      record: TaskAgentSessionRecord
    }

type SessionMenu =
  | { kind: 'record'; recordId: string; x: number; y: number }
  | { kind: 'folded'; x: number; y: number }

/** Opens a menu under the avatar that was clicked, or at the pointer for a right-click. */
function menuPointFor(event: MouseEvent<HTMLElement>): { x: number; y: number } {
  if (event.type === 'contextmenu') {
    return { x: event.clientX, y: event.clientY }
  }

  const box = event.currentTarget.getBoundingClientRect()
  return { x: box.left, y: box.bottom + 4 }
}

/**
 * The task card's sessions: a row of avatars, the running one with a live light. The linked Agent
 * window comes first, then past sessions newest first; what does not fit folds into "+N".
 * Clicking the linked avatar opens its window; clicking a past session opens its menu.
 */
export function TaskNodeAgentSessions({
  width,
  linkedAgentNode,
  agentSessions,
  currentDirectory,
  onResumeAgentSession,
  onRemoveAgentSessionRecord,
}: {
  width: number
  linkedAgentNode: LinkedAgentSummary | null
  agentSessions: TaskAgentSessionRecord[]
  currentDirectory: string
  onResumeAgentSession: (recordId: string) => void
  onRemoveAgentSessionRecord: (recordId: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [menu, setMenu] = useState<SessionMenu | null>(null)
  const [resumeConfirmRecordId, setResumeConfirmRecordId] = useState<string | null>(null)

  const entries = useMemo<SessionEntry[]>(() => {
    const records = [...agentSessions].sort((left, right) => {
      const leftTime = Date.parse(left.lastRunAt)
      const rightTime = Date.parse(right.lastRunAt)
      return (
        (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0)
      )
    })
    const linked: SessionEntry[] = linkedAgentNode
      ? [
          {
            kind: 'linked',
            key: `linked-${linkedAgentNode.nodeId}`,
            provider: linkedAgentNode.provider,
            status: linkedAgentNode.status,
            timestamp: linkedAgentNode.startedAt,
            description:
              linkedAgentNode.title.trim().length > 0
                ? linkedAgentNode.title
                : providerLabel(linkedAgentNode.provider),
            nodeId: linkedAgentNode.nodeId,
          },
        ]
      : []
    return [
      ...linked,
      ...records.map<SessionEntry>(record => ({
        kind: 'record',
        key: `record-${record.id}`,
        provider: record.provider,
        status: record.status,
        timestamp: record.lastRunAt,
        description: `${providerLabel(record.provider)} · ${record.effectiveModel ?? record.model ?? t('taskNode.defaultModel')}`,
        record,
      })),
    ]
  }, [agentSessions, linkedAgentNode, t])

  const { visible, folded } = resolveSessionAvatarSlots(width, entries.length)
  const visibleEntries = entries.slice(0, visible)
  const foldedEntries = entries.slice(visible)
  const runningCount = entries.filter(
    entry => resolveAgentSessionTone(entry.status) === 'working',
  ).length

  const menuRecord =
    menu?.kind === 'record'
      ? (agentSessions.find(record => record.id === menu.recordId) ?? null)
      : null
  const resumeConfirmRecord = resumeConfirmRecordId
    ? (agentSessions.find(record => record.id === resumeConfirmRecordId) ?? null)
    : null

  const openLinkedAgent = (nodeId: string): void => {
    const store = useAppStore.getState()
    const workspaceId = store.activeWorkspaceId
    if (!workspaceId) {
      return
    }

    store.setFocusRequest(previous => ({
      kind: 'node',
      workspaceId,
      nodeId,
      sequence: (previous?.sequence ?? 0) + 1,
    }))
  }

  const openEntry = (entry: SessionEntry, point: { x: number; y: number }): void => {
    if (entry.kind === 'linked') {
      setMenu(null)
      openLinkedAgent(entry.nodeId)
      return
    }

    setMenu({ kind: 'record', recordId: entry.record.id, ...point })
  }

  const renderAvatar = (entry: SessionEntry): JSX.Element => {
    const label = `${entry.description} · ${getAgentRuntimeLabel(t, entry.status)} · ${formatTaskTimestamp(entry.timestamp)}`
    return (
      <IconButton
        key={entry.key}
        label={label}
        className={`task-node__session task-node__session--${entry.kind}`}
        data-testid={
          entry.kind === 'linked'
            ? `task-node-agent-session-linked-${entry.nodeId}`
            : `task-node-agent-session-record-${entry.record.id}`
        }
        onClick={event => {
          event.stopPropagation()
          openEntry(entry, menuPointFor(event))
        }}
        onContextMenu={
          entry.kind === 'record'
            ? event => {
                event.preventDefault()
                event.stopPropagation()
                openEntry(entry, menuPointFor(event))
              }
            : undefined
        }
      >
        <AgentProviderIcon provider={entry.provider} />
        <span
          className={`task-node__session-light task-node__session-light--${resolveAgentSessionTone(entry.status)}`}
          aria-hidden="true"
        />
      </IconButton>
    )
  }

  const hint =
    entries.length === 0
      ? t('taskNode.noSessionsHint')
      : [
          t('taskNode.sessionCount', { count: entries.length }),
          ...(runningCount > 0 ? [t('taskNode.sessionsRunning', { count: runningCount })] : []),
        ].join(' · ')

  return (
    <>
      <div className="task-node__sessions nodrag" data-testid="task-node-agent-sessions">
        {visibleEntries.map(renderAvatar)}
        {folded > 0 ? (
          <IconButton
            label={t('taskNode.moreSessions', { count: folded })}
            className="task-node__session task-node__session--more"
            data-testid="task-node-agent-session-more"
            aria-haspopup="menu"
            aria-expanded={menu?.kind === 'folded'}
            onClick={event => {
              event.stopPropagation()
              setMenu({ kind: 'folded', ...menuPointFor(event) })
            }}
          >
            +{folded}
          </IconButton>
        ) : null}
        <span className="task-node__sessions-hint">{hint}</span>
      </div>

      {menu ? (
        <ViewportMenuSurface
          open={true}
          role="menu"
          aria-label={t('taskNode.agents')}
          mobileTitle={t('taskNode.agents')}
          className="workspace-context-menu task-agent-session-menu"
          data-testid="task-node-agent-session-menu"
          placement={{
            type: 'point',
            point: { x: menu.x, y: menu.y },
            estimatedSize: {
              width: menu.kind === 'folded' ? 240 : 188,
              height: menu.kind === 'folded' ? 8 + foldedEntries.length * 32 : 96,
            },
          }}
          onDismiss={() => {
            setMenu(null)
          }}
          dismissOnPointerDownOutside={true}
          dismissOnEscape={true}
        >
          {menu.kind === 'folded'
            ? foldedEntries.map(entry => (
                <MenuItem
                  key={entry.key}
                  icon={<AgentProviderIcon provider={entry.provider} />}
                  onClick={() => {
                    openEntry(entry, { x: menu.x, y: menu.y })
                  }}
                >
                  {`${entry.description} · ${formatTaskTimestamp(entry.timestamp)}`}
                </MenuItem>
              ))
            : null}
          {menu.kind === 'record' && menuRecord && isResumeSessionBindingVerified(menuRecord) ? (
            <MenuItem
              data-testid={`task-node-agent-session-menu-resume-${menu.recordId}`}
              icon={<UndoIcon />}
              onClick={() => {
                setResumeConfirmRecordId(menu.recordId)
                setMenu(null)
              }}
            >
              {t('taskNode.resume')}
            </MenuItem>
          ) : null}
          {menu.kind === 'record' ? (
            <MenuItem
              data-testid={`task-node-agent-session-menu-remove-${menu.recordId}`}
              tone="danger"
              icon={<TrashIcon />}
              onClick={() => {
                onRemoveAgentSessionRecord(menu.recordId)
                setMenu(null)
              }}
            >
              {t('taskNode.removeRecord')}
            </MenuItem>
          ) : null}
        </ViewportMenuSurface>
      ) : null}

      {resumeConfirmRecord ? (
        <TaskNodeResumeDialog
          record={resumeConfirmRecord}
          currentDirectory={currentDirectory}
          onCancel={() => {
            setResumeConfirmRecordId(null)
          }}
          onResume={() => {
            onResumeAgentSession(resumeConfirmRecord.id)
            setResumeConfirmRecordId(null)
          }}
        />
      ) : null}
    </>
  )
}
