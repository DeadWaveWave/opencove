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
  it.each([
    { dictionary: en, query: 'extensions' },
    { dictionary: zhCN, query: '插件' },
  ])('finds the plugin manager using $query', ({ dictionary, query }) => {
    const entries = createSettingsSearchEntries({ t: createTranslator(dictionary), workspaces: [] })
    expect(searchSettingsEntries(entries, query)[0]).toMatchObject({
      pageId: 'plugins',
      anchorId: 'settings-section-plugins',
    })
  })

  it.each([
    ['Node Creation Effect', en, 'settings-node-creation-pixel-effect'],
    ['Node Closing Effect', en, 'settings-node-close-pixel-effect'],
    ['Canvas Background Effect', en, 'settings-canvas-pixel-background'],
    ['创建效果', zhCN, 'settings-node-creation-pixel-effect'],
    ['关闭效果', zhCN, 'settings-node-close-pixel-effect'],
    ['画布背景效果', zhCN, 'settings-canvas-pixel-background'],
  ] as const)('finds the independent effect control %s', (query, dictionary, anchorId) => {
    const entries = createSettingsSearchEntries({
      t: createTranslator(dictionary),
      workspaces: [],
    })
    expect(searchSettingsEntries(entries, query)[0]).toMatchObject({
      pageId: 'appearance',
      anchorId,
    })
  })

  it('finds a localized settings entry by Chinese label', () => {
    const entries = createSettingsSearchEntries({
      t: createTranslator(zhCN),
      workspaces: [],
    })

    const results = searchSettingsEntries(entries, '外观')

    expect(results[0]).toMatchObject({
      id: 'general.theme',
      pageId: 'appearance',
      pageLabel: '外观',
      anchorId: 'settings-ui-theme',
    })
  })

  it.each([
    { dictionary: en, query: 'smooth slide' },
    { dictionary: zhCN, query: '平滑' },
  ])('finds the viewport transition setting using $query', ({ dictionary, query }) => {
    const entries = createSettingsSearchEntries({
      t: createTranslator(dictionary),
      workspaces: [],
    })
    expect(searchSettingsEntries(entries, query)[0]).toMatchObject({
      id: 'canvas.viewport-transition',
      pageId: 'canvas-windows',
      anchorId: 'settings-viewport-transition',
    })
  })

  it('always includes remote connections without obsolete mode or feature-toggle entries', () => {
    const entries = createSettingsSearchEntries({
      t: createTranslator(en),
      workspaces: [],
    })

    expect(searchSettingsEntries(entries, 'endpoint')[0]).toMatchObject({
      id: 'endpoints.list',
      pageId: 'worker',
      title: 'Remote Connections',
    })
    expect(entries.some(entry => entry.id === 'worker.home')).toBe(false)
    expect(entries.some(entry => entry.id === 'experimental.remote-workers')).toBe(false)
  })

  it.each([
    { dictionary: en, query: 'nearby free space' },
    { dictionary: zhCN, query: '在附近空位展开' },
  ])('finds the window expansion setting using $query', ({ dictionary, query }) => {
    const entries = createSettingsSearchEntries({
      t: createTranslator(dictionary),
      workspaces: [],
    })
    expect(searchSettingsEntries(entries, query)[0]).toMatchObject({
      id: 'canvas.node-expansion',
      pageId: 'canvas-windows',
      anchorId: 'settings-node-expand-behavior',
    })
  })

  it('includes workspace settings and falls back to the folder name', () => {
    const entries = createSettingsSearchEntries({
      t: createTranslator(en),
      workspaces: [createWorkspace({ name: '', path: '/Users/example/My Project' })],
    })

    const results = searchSettingsEntries(entries, 'My Project')

    expect(results[0]).toMatchObject({
      id: 'workspace.workspace-1',
      pageId: 'workspace:workspace-1',
      title: 'My Project',
      anchorId: 'settings-section-workspace-workspace-1',
    })
  })

  it('finds the performance diagnostics page', () => {
    const entries = createSettingsSearchEntries({
      t: createTranslator(en),
      workspaces: [],
    })

    const results = searchSettingsEntries(entries, 'memory diagnostics')

    expect(results[0]).toMatchObject({
      id: 'diagnostics.performance',
      pageId: 'advanced',
      pageLabel: 'Advanced',
      anchorId: 'settings-section-diagnostics',
    })
  })

  it('routes every terminal control to its single editor', () => {
    const entries = createSettingsSearchEntries({
      t: createTranslator(en),
      workspaces: [],
    })
    for (const id of [
      'general.terminal-font-size',
      'general.terminal-font-family',
      'general.terminal-display-calibration',
      'canvas.terminal-profile',
    ]) {
      expect(entries.find(entry => entry.id === id)?.pageId).toBe('terminal')
    }
  })

  it('provides exact provider destinations while hiding unavailable feature gates', () => {
    const entries = createSettingsSearchEntries({
      t: createTranslator(en),
      workspaces: [],
    })
    expect(entries.find(entry => entry.id === 'agent.codex.models')).toMatchObject({
      pageId: 'agent',
      provider: 'codex',
      anchorId: 'settings-agent-models-codex',
    })
    expect(
      searchSettingsEntries(entries, 'codex model').some(
        entry => entry.id === 'agent.codex.models',
      ),
    ).toBe(true)
    expect(entries.some(entry => entry.provider === 'gemini')).toBe(false)
    expect(entries.some(entry => entry.id === 'tasks.title-generation')).toBe(false)
    expect(entries.find(entry => entry.id === 'tasks.tags')?.pageId).toBe('task-configuration')
  })
})
