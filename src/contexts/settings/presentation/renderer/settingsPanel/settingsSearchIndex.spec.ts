import { describe, expect, it } from 'vitest'
import { zhCN } from '@app/renderer/i18n/locales/zh-CN'
import { en } from '@app/renderer/i18n/locales/en'
import type { TranslationDictionary } from '@app/renderer/i18n/locales/schema'
import type { TranslateFn } from '@app/renderer/i18n'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { createSettingsSearchEntries, searchSettingsEntries } from './settingsSearchIndex'

function createTranslator(dictionary: TranslationDictionary): TranslateFn {
  return key => {
    const value = key.split('.').reduce<unknown>((current, part) => {
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        return undefined
      }
      return (current as Record<string, unknown>)[part]
    }, dictionary)

    return typeof value === 'string' ? value : key
  }
}

function createWorkspace(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    id: 'workspace-1',
    name: 'Cove App',
    path: '/Users/example/cove',
    worktreesRoot: '.opencove/worktrees',
    environmentVariables: {},
    nodes: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    isMinimapVisible: false,
    spaces: [],
    activeSpaceId: null,
    spaceArchiveRecords: [],
    ...overrides,
  }
}

describe('settingsSearchIndex', () => {
  it('finds a localized settings entry by Chinese label', () => {
    const entries = createSettingsSearchEntries({
      t: createTranslator(zhCN),
      workspaces: [],
      endpointsEnabled: false,
    })

    const results = searchSettingsEntries(entries, '外观')

    expect(results[0]).toMatchObject({
      id: 'general.theme',
      pageId: 'general',
      anchorId: 'settings-ui-theme',
    })
  })

  it('filters endpoint entries when remote workers are disabled', () => {
    const entries = createSettingsSearchEntries({
      t: createTranslator(en),
      workspaces: [],
      endpointsEnabled: false,
    })

    expect(searchSettingsEntries(entries, 'endpoint')).toHaveLength(0)
  })

  it('includes workspace settings and falls back to the folder name', () => {
    const entries = createSettingsSearchEntries({
      t: createTranslator(en),
      workspaces: [createWorkspace({ name: '', path: '/Users/example/My Project' })],
      endpointsEnabled: false,
    })

    const results = searchSettingsEntries(entries, 'My Project')

    expect(results[0]).toMatchObject({
      id: 'workspace.workspace-1',
      pageId: 'workspace:workspace-1',
      title: 'My Project',
      anchorId: 'settings-section-workspace-workspace-1',
    })
  })
})
