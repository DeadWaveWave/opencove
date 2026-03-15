import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { AGENT_PROVIDER_LABEL } from '@contexts/settings/domain/agentSettings'
import type { PersistNotice, ProjectContextMenuState } from '../types'
import { toRelativeTime } from '../utils/format'
import type {
  TerminalNodeData,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'

type SidebarAgentStatus = 'working' | 'standby'

type SidebarStatusTone = 'working' | 'standby'

function resolveSidebarAgentStatus(runtimeStatus: TerminalNodeData['status']): SidebarAgentStatus {
  if (runtimeStatus === 'running' || runtimeStatus === 'restoring') {
    return 'working'
  }

  return 'standby'
}

export function Sidebar({
  workspaces,
  activeWorkspaceId,
  activeProviderLabel,
  activeProviderModel,
  persistNotice,
  onAddWorkspace,
  onSelectWorkspace,
  onOpenProjectContextMenu,
  onSelectAgentNode,
  onOpenSettings,
}: {
  workspaces: WorkspaceState[]
  activeWorkspaceId: string | null
  activeProviderLabel: string
  activeProviderModel: string
  persistNotice: PersistNotice | null
  onAddWorkspace: () => void
  onSelectWorkspace: (workspaceId: string) => void
  onOpenProjectContextMenu: (state: ProjectContextMenuState) => void
  onSelectAgentNode: (workspaceId: string, nodeId: string) => void
  onOpenSettings: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <aside className="workspace-sidebar">
      <div className="workspace-sidebar__header">
        <div className="workspace-sidebar__header-main">
          <h1>{t('sidebar.projects')}</h1>
        </div>
        <button
          type="button"
          onClick={() => {
            onAddWorkspace()
          }}
        >
          {t('sidebar.addProject')}
        </button>
      </div>

      <div className="workspace-sidebar__agent">
        <span className="workspace-sidebar__agent-label">{t('sidebar.defaultAgent')}</span>
        <strong className="workspace-sidebar__agent-provider">{activeProviderLabel}</strong>
        <span className="workspace-sidebar__agent-model">{activeProviderModel}</span>
      </div>

      {persistNotice ? (
        <div
          className={`workspace-sidebar__persist-alert workspace-sidebar__persist-alert--${persistNotice.tone}`}
        >
          <strong>{t('sidebar.persistence')}</strong>
          <span>{persistNotice.message}</span>
        </div>
      ) : null}

      <div className="workspace-sidebar__list">
        {workspaces.length === 0 ? (
          <p className="workspace-sidebar__empty">{t('sidebar.noProjectYet')}</p>
        ) : null}

        {workspaces.map(workspace => {
          const isActive = workspace.id === activeWorkspaceId
          const workspaceAgents = workspace.nodes
            .filter(node => node.data.kind === 'agent')
            .sort((left, right) => {
              const leftTime = left.data.startedAt ? Date.parse(left.data.startedAt) : 0
              const rightTime = right.data.startedAt ? Date.parse(right.data.startedAt) : 0
              return rightTime - leftTime
            })
          const terminalCount = workspace.nodes.filter(node => node.data.kind === 'terminal').length
          const agentCount = workspace.nodes.filter(node => node.data.kind === 'agent').length
          const taskCount = workspace.nodes.filter(node => node.data.kind === 'task').length
          const metaText = [
            t('sidebar.terminals', { count: terminalCount }),
            t('sidebar.agents', { count: agentCount }),
            t('sidebar.tasks', { count: taskCount }),
          ].join(' · ')

          return (
            <div className="workspace-item-group" key={workspace.id}>
              <button
                type="button"
                className={`workspace-item ${isActive ? 'workspace-item--active' : ''}`}
                onClick={() => {
                  onSelectWorkspace(workspace.id)
                }}
                onContextMenu={event => {
                  event.preventDefault()
                  onOpenProjectContextMenu({
                    workspaceId: workspace.id,
                    x: event.clientX,
                    y: event.clientY,
                  })
                }}
                title={workspace.path}
              >
                <span className="workspace-item__name">{workspace.name}</span>
                <span className="workspace-item__path">{workspace.path}</span>
                <span className="workspace-item__meta">{metaText}</span>
              </button>

              {workspaceAgents.length > 0 ? (
                <div className="workspace-item__agents">
                  {workspaceAgents.map(node => {
                    const provider = node.data.agent?.provider
                    const providerText = provider
                      ? AGENT_PROVIDER_LABEL[provider]
                      : t('sidebar.fallbackAgentLabel')
                    const linkedTaskNode =
                      (node.data.agent?.taskId
                        ? (workspace.nodes.find(
                            candidate =>
                              candidate.id === node.data.agent?.taskId &&
                              candidate.data.kind === 'task' &&
                              candidate.data.task,
                          ) ?? null)
                        : null) ??
                      workspace.nodes.find(
                        candidate =>
                          candidate.data.kind === 'task' &&
                          candidate.data.task?.linkedAgentNodeId === node.id,
                      ) ??
                      null
                    const sidebarAgentStatus = resolveSidebarAgentStatus(node.data.status)
                    const sidebarAgentStatusTone: SidebarStatusTone =
                      sidebarAgentStatus === 'working' ? 'working' : 'standby'
                    const startedText = toRelativeTime(node.data.startedAt)
                    const sidebarAgentStatusText =
                      sidebarAgentStatus === 'working'
                        ? t('sidebar.status.working')
                        : t('sidebar.status.standby')
                    const taskTitle =
                      linkedTaskNode && linkedTaskNode.data.kind === 'task'
                        ? linkedTaskNode.data.title
                        : null

                    return (
                      <button
                        type="button"
                        key={`${workspace.id}:${node.id}`}
                        className="workspace-agent-item workspace-agent-item--nested"
                        data-testid={`workspace-agent-item-${workspace.id}-${node.id}`}
                        onClick={() => {
                          onSelectAgentNode(workspace.id, node.id)
                        }}
                      >
                        <span className="workspace-agent-item__headline">
                          <span className="workspace-agent-item__title">{node.data.title}</span>
                        </span>
                        <span className="workspace-agent-item__meta">
                          <span className="workspace-agent-item__meta-text">
                            {providerText} · {startedText}
                          </span>
                          <span
                            className={`workspace-agent-item__status workspace-agent-item__status--agent workspace-agent-item__status--${sidebarAgentStatusTone}`}
                          >
                            {sidebarAgentStatusText}
                          </span>
                        </span>
                        {taskTitle ? (
                          <span className="workspace-agent-item__task" title={taskTitle}>
                            <span className="workspace-agent-item__task-text">{taskTitle}</span>
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="workspace-sidebar__footer">
        <button
          type="button"
          className="workspace-sidebar__settings"
          onClick={() => {
            onOpenSettings()
          }}
        >
          {t('sidebar.settings')}
        </button>
      </div>
    </aside>
  )
}
