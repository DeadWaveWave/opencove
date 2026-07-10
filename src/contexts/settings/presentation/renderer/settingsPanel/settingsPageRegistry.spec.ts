import { describe, expect, it } from 'vitest'
import type { SettingsPageId } from '../SettingsPanel.shared'
import {
  SETTINGS_PAGE_REGISTRY,
  SETTINGS_PRIMARY_NAV_GROUPS,
  resolveSettingsPage,
} from './settingsPageRegistry'

type StaticSettingsPageId = Exclude<SettingsPageId, `workspace:${string}`>

const EXPECTED_CANONICAL_PAGE_IDS = {
  general: 'general',
  appearance: 'appearance',
  'canvas-windows': 'canvas-windows',
  worker: 'worker',
  endpoints: 'worker',
  agent: 'agent',
  'tasks-shortcuts': 'tasks-shortcuts',
  'quick-menu': 'tasks-shortcuts',
  notifications: 'notifications',
  canvas: 'canvas-windows',
  advanced: 'advanced',
  experimental: 'advanced',
  shortcuts: 'tasks-shortcuts',
  'task-configuration': 'tasks-shortcuts',
  integrations: 'integrations',
  diagnostics: 'advanced',
} as const satisfies Record<StaticSettingsPageId, StaticSettingsPageId>

const STATIC_PAGE_IDS = Object.keys(EXPECTED_CANONICAL_PAGE_IDS) as StaticSettingsPageId[]

const SECONDARY_ALIASES = [
  'canvas',
  'shortcuts',
  'quick-menu',
  'task-configuration',
  'endpoints',
  'experimental',
  'diagnostics',
] as const satisfies readonly StaticSettingsPageId[]

describe('settingsPageRegistry', () => {
  it('resolves every static page id to a canonical page', () => {
    const registeredPageIds = Object.keys(SETTINGS_PAGE_REGISTRY)
    expect(registeredPageIds).toHaveLength(STATIC_PAGE_IDS.length)
    expect(registeredPageIds).toEqual(expect.arrayContaining(STATIC_PAGE_IDS))

    for (const pageId of STATIC_PAGE_IDS) {
      const resolvedPage = resolveSettingsPage(pageId)

      expect(resolvedPage).toBeDefined()
      expect(resolvedPage.canonicalPageId).toBe(EXPECTED_CANONICAL_PAGE_IDS[pageId])
    }
  })

  it('normalizes secondary page aliases', () => {
    expect(
      Object.fromEntries(
        SECONDARY_ALIASES.map(pageId => [pageId, resolveSettingsPage(pageId).canonicalPageId]),
      ),
    ).toEqual({
      canvas: 'canvas-windows',
      shortcuts: 'tasks-shortcuts',
      'quick-menu': 'tasks-shortcuts',
      'task-configuration': 'tasks-shortcuts',
      endpoints: 'worker',
      experimental: 'advanced',
      diagnostics: 'advanced',
    })
  })

  it('defines primary navigation in four groups without secondary aliases', () => {
    expect(SETTINGS_PRIMARY_NAV_GROUPS).toEqual([
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
    ])

    const primaryPageIds = SETTINGS_PRIMARY_NAV_GROUPS.flatMap(group => group.pageIds)
    expect(primaryPageIds).not.toEqual(expect.arrayContaining([...SECONDARY_ALIASES]))
  })

  it('keeps legacy scroll targets on their registry entries', () => {
    expect(
      Object.fromEntries(
        STATIC_PAGE_IDS.flatMap(pageId => {
          const { scrollTargetId } = resolveSettingsPage(pageId)
          return scrollTargetId ? [[pageId, scrollTargetId]] : []
        }),
      ),
    ).toEqual({
      endpoints: 'settings-section-endpoints',
      'quick-menu': 'settings-section-quick-commands',
      shortcuts: 'settings-section-shortcuts',
      'task-configuration': 'settings-section-task-configuration',
      diagnostics: 'settings-section-diagnostics',
    })
  })
})
