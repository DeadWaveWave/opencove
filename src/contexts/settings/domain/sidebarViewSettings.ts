import { isValidProvider, type AgentProvider } from './agentSettings.providers'
import { normalizeSidebarCollapsedIds } from './sidebarTreeSettings'

export type SidebarStatusFilter = 'all' | 'working' | 'waiting' | 'standby'
export type SidebarVisibilityFilter = 'visible' | 'all' | 'hidden'

export interface SidebarViewFilters {
  status: SidebarStatusFilter
  provider: AgentProvider | 'all'
  visibility: SidebarVisibilityFilter
}

export interface SidebarViewSettings {
  hiddenSpaceIds: Record<string, boolean>
  hiddenAgentIds: Record<string, boolean>
  filters: SidebarViewFilters
}

export const DEFAULT_SIDEBAR_VIEW_FILTERS: SidebarViewFilters = {
  status: 'all',
  provider: 'all',
  visibility: 'visible',
}

export const DEFAULT_SIDEBAR_VIEW_SETTINGS: SidebarViewSettings = {
  hiddenSpaceIds: {},
  hiddenAgentIds: {},
  filters: DEFAULT_SIDEBAR_VIEW_FILTERS,
}

export function sidebarVisibilityKey(workspaceId: string, itemId: string): string {
  return `${workspaceId}:${itemId}`
}

export function normalizeSidebarViewSettings(value: unknown): SidebarViewSettings {
  const input = isRecord(value) ? value : {}
  const filters = isRecord(input.filters) ? input.filters : {}
  return {
    hiddenSpaceIds: normalizeSidebarCollapsedIds(input.hiddenSpaceIds),
    hiddenAgentIds: normalizeSidebarCollapsedIds(input.hiddenAgentIds),
    filters: {
      status:
        filters.status === 'working' || filters.status === 'waiting' || filters.status === 'standby'
          ? filters.status
          : 'all',
      provider: isValidProvider(filters.provider) ? filters.provider : 'all',
      visibility:
        filters.visibility === 'all' || filters.visibility === 'hidden'
          ? filters.visibility
          : 'visible',
    },
  }
}

export function setSidebarItemHidden(
  view: SidebarViewSettings,
  kind: 'space' | 'agent',
  workspaceId: string,
  itemId: string,
  hidden: boolean,
): SidebarViewSettings {
  const field = kind === 'space' ? 'hiddenSpaceIds' : 'hiddenAgentIds'
  const key = sidebarVisibilityKey(workspaceId, itemId)
  if ((view[field][key] === true) === hidden) {
    return view
  }
  const ids = { ...view[field] }
  if (hidden) {
    ids[key] = true
  } else {
    delete ids[key]
  }
  return { ...view, [field]: ids }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
