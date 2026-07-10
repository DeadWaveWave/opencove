import {
  isWorkspacePageId,
  type SettingsPageId,
} from '@contexts/settings/presentation/renderer/SettingsPanel.shared'

export type StaticSettingsPageId = Exclude<SettingsPageId, `workspace:${string}`>

export type CanonicalSettingsPageId =
  | 'general'
  | 'appearance'
  | 'notifications'
  | 'canvas-windows'
  | 'agent'
  | 'tasks-shortcuts'
  | 'worker'
  | 'integrations'
  | 'advanced'

export type SettingsNavGroupId = 'application' | 'workspace' | 'connections' | 'advanced'

export type SettingsPageIconId =
  | 'settings'
  | 'palette'
  | 'bell'
  | 'layout-dashboard'
  | 'bot'
  | 'list-checks'
  | 'server'
  | 'plug'
  | 'wrench'
  | 'folder'

export interface SettingsPageRegistryEntry {
  canonicalPageId: CanonicalSettingsPageId
  scrollTargetId?: string
}

export interface CanonicalSettingsPageDefinition {
  canonicalPageId: CanonicalSettingsPageId
  groupId: SettingsNavGroupId
  navLabelKey: string
  descriptionKey?: string
  iconId: SettingsPageIconId
  testId: string
}

export const CANONICAL_SETTINGS_PAGE_DEFINITIONS: Readonly<
  Record<CanonicalSettingsPageId, CanonicalSettingsPageDefinition>
> = {
  general: {
    canonicalPageId: 'general',
    groupId: 'application',
    navLabelKey: 'settingsPanel.nav.general',
    descriptionKey: 'settingsPanel.pageDescriptions.general',
    iconId: 'settings',
    testId: 'settings-section-nav-general',
  },
  appearance: {
    canonicalPageId: 'appearance',
    groupId: 'application',
    navLabelKey: 'settingsPanel.nav.appearance',
    descriptionKey: 'settingsPanel.pageDescriptions.appearance',
    iconId: 'palette',
    testId: 'settings-section-nav-appearance',
  },
  notifications: {
    canonicalPageId: 'notifications',
    groupId: 'application',
    navLabelKey: 'settingsPanel.nav.notifications',
    descriptionKey: 'settingsPanel.pageDescriptions.notifications',
    iconId: 'bell',
    testId: 'settings-section-nav-notifications',
  },
  'canvas-windows': {
    canonicalPageId: 'canvas-windows',
    groupId: 'workspace',
    navLabelKey: 'settingsPanel.nav.canvasWindows',
    descriptionKey: 'settingsPanel.pageDescriptions.canvasWindows',
    iconId: 'layout-dashboard',
    testId: 'settings-section-nav-canvas',
  },
  agent: {
    canonicalPageId: 'agent',
    groupId: 'workspace',
    navLabelKey: 'settingsPanel.nav.agent',
    descriptionKey: 'settingsPanel.pageDescriptions.agent',
    iconId: 'bot',
    testId: 'settings-section-nav-agent',
  },
  'tasks-shortcuts': {
    canonicalPageId: 'tasks-shortcuts',
    groupId: 'workspace',
    navLabelKey: 'settingsPanel.nav.tasksShortcuts',
    descriptionKey: 'settingsPanel.pageDescriptions.tasksShortcuts',
    iconId: 'list-checks',
    testId: 'settings-section-nav-task-configuration',
  },
  worker: {
    canonicalPageId: 'worker',
    groupId: 'connections',
    navLabelKey: 'settingsPanel.nav.workerConnections',
    descriptionKey: 'settingsPanel.pageDescriptions.worker',
    iconId: 'server',
    testId: 'settings-section-nav-worker',
  },
  integrations: {
    canonicalPageId: 'integrations',
    groupId: 'connections',
    navLabelKey: 'settingsPanel.nav.integrations',
    descriptionKey: 'settingsPanel.pageDescriptions.integrations',
    iconId: 'plug',
    testId: 'settings-section-nav-integrations',
  },
  advanced: {
    canonicalPageId: 'advanced',
    groupId: 'advanced',
    navLabelKey: 'settingsPanel.nav.advanced',
    descriptionKey: 'settingsPanel.pageDescriptions.advanced',
    iconId: 'wrench',
    testId: 'settings-section-nav-experimental',
  },
}

export const SETTINGS_PAGE_REGISTRY: Readonly<
  Record<StaticSettingsPageId, SettingsPageRegistryEntry>
> = {
  general: { canonicalPageId: 'general' },
  appearance: { canonicalPageId: 'appearance' },
  'canvas-windows': { canonicalPageId: 'canvas-windows' },
  worker: { canonicalPageId: 'worker' },
  endpoints: {
    canonicalPageId: 'worker',
    scrollTargetId: 'settings-section-endpoints',
  },
  agent: { canonicalPageId: 'agent' },
  'tasks-shortcuts': { canonicalPageId: 'tasks-shortcuts' },
  'quick-menu': {
    canonicalPageId: 'tasks-shortcuts',
    scrollTargetId: 'settings-section-quick-commands',
  },
  notifications: { canonicalPageId: 'notifications' },
  canvas: { canonicalPageId: 'canvas-windows' },
  advanced: { canonicalPageId: 'advanced' },
  experimental: { canonicalPageId: 'advanced' },
  shortcuts: {
    canonicalPageId: 'tasks-shortcuts',
    scrollTargetId: 'settings-section-shortcuts',
  },
  'task-configuration': {
    canonicalPageId: 'tasks-shortcuts',
    scrollTargetId: 'settings-section-task-configuration',
  },
  integrations: { canonicalPageId: 'integrations' },
  diagnostics: {
    canonicalPageId: 'advanced',
    scrollTargetId: 'settings-section-diagnostics',
  },
}

export interface SettingsPrimaryNavGroup {
  id: SettingsNavGroupId
  pageIds: readonly CanonicalSettingsPageId[]
}

export const SETTINGS_PRIMARY_NAV_GROUPS: readonly SettingsPrimaryNavGroup[] = [
  {
    id: 'application',
    pageIds: ['general', 'appearance', 'notifications'],
  },
  {
    id: 'workspace',
    pageIds: ['canvas-windows', 'agent', 'tasks-shortcuts'],
  },
  {
    id: 'connections',
    pageIds: ['worker', 'integrations'],
  },
  {
    id: 'advanced',
    pageIds: ['advanced'],
  },
]

export interface ResolvedSettingsPage {
  requestedPageId: SettingsPageId
  canonicalPageId: SettingsPageId
  groupId?: SettingsNavGroupId
  navLabelKey?: string
  descriptionKey?: string
  iconId: SettingsPageIconId
  testId?: string
  scrollTargetId?: string
}

export function resolveSettingsPage(pageId: SettingsPageId): ResolvedSettingsPage {
  if (isWorkspacePageId(pageId)) {
    return {
      requestedPageId: pageId,
      canonicalPageId: pageId,
      navLabelKey: 'settingsPanel.nav.projects',
      iconId: 'folder',
    }
  }

  const registryEntry = SETTINGS_PAGE_REGISTRY[pageId]
  const canonicalDefinition = CANONICAL_SETTINGS_PAGE_DEFINITIONS[registryEntry.canonicalPageId]

  return {
    requestedPageId: pageId,
    ...canonicalDefinition,
    scrollTargetId: registryEntry.scrollTargetId,
  }
}
