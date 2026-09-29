import { describe, expect, it } from 'vitest'
import type { SettingsPageId } from '../SettingsPanel.shared'
import {
  SETTINGS_PAGE_REGISTRY,
  SETTINGS_PRIMARY_PAGE_IDS,
  resolveSettingsPage,
} from './settingsPageRegistry'

type StaticSettingsPageId = Exclude<SettingsPageId, `workspace:${string}`>

const EXPECTED_CANONICAL_PAGE_IDS = {
  general: 'general',
  appearance: 'appearance',
  terminal: 'terminal',
  'canvas-windows': 'canvas-windows',
  worker: 'worker',
  endpoints: 'worker',
  agent: 'agent',
  plugins: 'plugins',
  'tasks-shortcuts': 'tasks-shortcuts',
  'quick-menu': 'tasks-shortcuts',
  notifications: 'general',
  canvas: 'canvas-windows',
  advanced: 'advanced',
  experimental: 'advanced',
  shortcuts: 'tasks-shortcuts',
  'task-configuration': 'agent',
  integrations: 'worker',
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
      'task-configuration': 'agent',
      endpoints: 'worker',
      experimental: 'advanced',
      diagnostics: 'advanced',
    })
  })

  it('exposes eight distinct purposes with terminal and plugin settings in their own pages', () => {
    expect(SETTINGS_PRIMARY_PAGE_IDS).toEqual([
      'general',
      'appearance',
      'canvas-windows',
      'agent',
      'terminal',
      'tasks-shortcuts',
      'worker',
      'plugins',
    ])
    expect(new Set(SETTINGS_PRIMARY_PAGE_IDS).size).toBe(8)
    expect(SETTINGS_PRIMARY_PAGE_IDS).not.toEqual(expect.arrayContaining([...SECONDARY_ALIASES]))
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
      notifications: 'settings-section-notifications',
      integrations: 'settings-section-integrations',
      diagnostics: 'settings-section-diagnostics',
    })
  })
})
