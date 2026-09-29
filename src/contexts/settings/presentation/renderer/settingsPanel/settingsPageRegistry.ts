import { isWorkspacePageId, type SettingsPageId } from '../SettingsPanel.shared'

export type StaticSettingsPageId = Exclude<SettingsPageId, `workspace:${string}`>
export type CanonicalSettingsPageId =
  | 'general'
  | 'appearance'
  | 'canvas-windows'
  | 'agent'
  | 'plugins'
  | 'terminal'
  | 'tasks-shortcuts'
  | 'worker'
  | 'advanced'

export type SettingsPageIconId =
  | 'settings'
  | 'palette'
  | 'layout-dashboard'
  | 'sparkles'
  | 'puzzle'
  | 'terminal'
  | 'keyboard'
  | 'server'
  | 'wrench'
  | 'folder'

export interface SettingsPageRegistryEntry {
  canonicalPageId: CanonicalSettingsPageId
  scrollTargetId?: string
}

export interface CanonicalSettingsPageDefinition {
  canonicalPageId: CanonicalSettingsPageId
  navLabelKey: string
  descriptionKey: string
  iconId: SettingsPageIconId
  testId: string
}

export const CANONICAL_SETTINGS_PAGE_DEFINITIONS: Readonly<
  Record<CanonicalSettingsPageId, CanonicalSettingsPageDefinition>
> = {
  general: {
    canonicalPageId: 'general',
    navLabelKey: 'settingsPanel.nav.general',
    descriptionKey: 'settingsPanel.pageDescriptions.general',
    iconId: 'settings',
    testId: 'settings-section-nav-general',
  },
  appearance: {
    canonicalPageId: 'appearance',
    navLabelKey: 'settingsPanel.nav.appearance',
    descriptionKey: 'settingsPanel.pageDescriptions.appearance',
    iconId: 'palette',
    testId: 'settings-section-nav-appearance',
  },
  'canvas-windows': {
    canonicalPageId: 'canvas-windows',
    navLabelKey: 'settingsPanel.nav.canvasWindows',
    descriptionKey: 'settingsPanel.pageDescriptions.canvasWindows',
    iconId: 'layout-dashboard',
    testId: 'settings-section-nav-canvas',
  },
  agent: {
    canonicalPageId: 'agent',
    navLabelKey: 'settingsPanel.nav.agent',
    descriptionKey: 'settingsPanel.pageDescriptions.agent',
    iconId: 'sparkles',
    testId: 'settings-section-nav-agent',
  },
  plugins: {
    canonicalPageId: 'plugins',
    navLabelKey: 'settingsPanel.nav.plugins',
    descriptionKey: 'settingsPanel.pageDescriptions.plugins',
    iconId: 'puzzle',
    testId: 'settings-section-nav-plugins',
  },
  terminal: {
    canonicalPageId: 'terminal',
    navLabelKey: 'settingsPanel.nav.terminal',
    descriptionKey: 'settingsPanel.pageDescriptions.terminal',
    iconId: 'terminal',
    testId: 'settings-section-nav-terminal',
  },
  'tasks-shortcuts': {
    canonicalPageId: 'tasks-shortcuts',
    navLabelKey: 'settingsPanel.nav.tasksShortcuts',
    descriptionKey: 'settingsPanel.pageDescriptions.tasksShortcuts',
    iconId: 'keyboard',
    testId: 'settings-section-nav-shortcuts',
  },
  worker: {
    canonicalPageId: 'worker',
    navLabelKey: 'settingsPanel.nav.workerConnections',
    descriptionKey: 'settingsPanel.pageDescriptions.worker',
    iconId: 'server',
    testId: 'settings-section-nav-worker',
  },
  advanced: {
    canonicalPageId: 'advanced',
    navLabelKey: 'settingsPanel.nav.advanced',
    descriptionKey: 'settingsPanel.pageDescriptions.advanced',
    iconId: 'wrench',
    testId: 'settings-section-nav-experimental',
  },
}

/** Keep old entry points valid when their canonical editor moves. */
export const SETTINGS_PAGE_REGISTRY: Readonly<
  Record<StaticSettingsPageId, SettingsPageRegistryEntry>
> = {
  general: { canonicalPageId: 'general' },
  appearance: { canonicalPageId: 'appearance' },
  terminal: { canonicalPageId: 'terminal' },
  'canvas-windows': { canonicalPageId: 'canvas-windows' },
  worker: { canonicalPageId: 'worker' },
  endpoints: { canonicalPageId: 'worker', scrollTargetId: 'settings-section-endpoints' },
  agent: { canonicalPageId: 'agent' },
  plugins: { canonicalPageId: 'plugins' },
  'tasks-shortcuts': { canonicalPageId: 'tasks-shortcuts' },
  'quick-menu': {
    canonicalPageId: 'tasks-shortcuts',
    scrollTargetId: 'settings-section-quick-commands',
  },
  notifications: {
    canonicalPageId: 'general',
    scrollTargetId: 'settings-section-notifications',
  },
  canvas: { canonicalPageId: 'canvas-windows' },
  advanced: { canonicalPageId: 'advanced' },
  experimental: { canonicalPageId: 'advanced' },
  shortcuts: {
    canonicalPageId: 'tasks-shortcuts',
    scrollTargetId: 'settings-section-shortcuts',
  },
  'task-configuration': {
    canonicalPageId: 'agent',
    scrollTargetId: 'settings-section-task-configuration',
  },
  integrations: { canonicalPageId: 'worker', scrollTargetId: 'settings-section-integrations' },
  diagnostics: { canonicalPageId: 'advanced', scrollTargetId: 'settings-section-diagnostics' },
}

export const SETTINGS_PRIMARY_PAGE_IDS: readonly CanonicalSettingsPageId[] = [
  'general',
  'appearance',
  'canvas-windows',
  'agent',
  'terminal',
  'tasks-shortcuts',
  'worker',
  'plugins',
]

export interface ResolvedSettingsPage {
  requestedPageId: SettingsPageId
  canonicalPageId: SettingsPageId
  navLabelKey: string
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

  const entry = SETTINGS_PAGE_REGISTRY[pageId]
  return {
    requestedPageId: pageId,
    ...CANONICAL_SETTINGS_PAGE_DEFINITIONS[entry.canonicalPageId],
    scrollTargetId: entry.scrollTargetId,
  }
}
