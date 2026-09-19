import React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import {
  setSidebarItemHidden,
  sidebarVisibilityKey,
} from '@contexts/settings/domain/sidebarViewSettings'
import type { ProjectContextMenuTarget } from '../types'
import { useAppStore } from '../store/useAppStore'
import { buildSidebarProjectTree } from '../utils/sidebarTree'

export function SidebarVisibilityMenuItem({
  target,
}: {
  target: ProjectContextMenuTarget
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const view = useAppStore(state => state.agentSettings.sidebarView)
  const workspace = useAppStore(state =>
    state.workspaces.find(item => item.id === target.workspaceId),
  )
  if (target.kind === 'project') {
    return null
  }
  const id = target.kind === 'space' ? target.spaceId : target.nodeId
  const key = sidebarVisibilityKey(target.workspaceId, id)
  const hidden = (target.kind === 'space' ? view.hiddenSpaceIds : view.hiddenAgentIds)[key] === true
  if (target.kind === 'agent' && workspace) {
    const parent = buildSidebarProjectTree(workspace).spaceGroups.find(group =>
      group.agents.some(agent => agent.node.id === target.nodeId),
    )
    if (parent && view.hiddenSpaceIds[sidebarVisibilityKey(target.workspaceId, parent.id)]) {
      return null
    }
  }
  const Icon = hidden ? Eye : EyeOff
  return (
    <button
      type="button"
      data-testid="workspace-sidebar-visibility-action"
      onClick={() => {
        const store = useAppStore.getState()
        store.setAgentSettings(previous => ({
          ...previous,
          sidebarView: setSidebarItemHidden(
            previous.sidebarView,
            target.kind,
            target.workspaceId,
            id,
            !hidden,
          ),
        }))
        store.setProjectContextMenu(null)
      }}
    >
      <Icon className="workspace-context-menu__icon" aria-hidden="true" />
      <span className="workspace-context-menu__label">
        {t(hidden ? 'sidebar.restore' : 'sidebar.hide')}
      </span>
    </button>
  )
}
