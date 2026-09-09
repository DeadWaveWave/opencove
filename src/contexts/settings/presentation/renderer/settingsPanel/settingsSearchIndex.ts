import type { TranslateFn } from '@app/renderer/i18n'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { getFolderName, getWorkspacePageId, type SettingsPageId } from '../SettingsPanel.shared'
import { resolveSettingsPage } from './settingsPageRegistry'
import { AGENT_PROVIDER_LABEL, type AgentProvider } from '@contexts/settings/domain/agentSettings'
import { AI_NAMING_FEATURES } from '@shared/featureFlags/aiNaming'
import { CORE_SEARCH_ENTRY_DEFINITIONS } from './settingsSearchIndex.definitions'
import type { CoreSettingsSearchEntryDefinition } from './settingsSearchTypes'

export interface SettingsSearchEntry {
  id: string
  pageId: SettingsPageId
  pageLabel: string
  title: string
  description?: string
  anchorId: string
  keywords: string[]
  provider?: AgentProvider | 'default'
}

export interface SettingsSearchResult extends SettingsSearchEntry {
  score: number
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function resolveEntry(
  definition: CoreSettingsSearchEntryDefinition,
  t: TranslateFn,
): SettingsSearchEntry {
  const { navLabelKey } = resolveSettingsPage(definition.pageId)
  if (!navLabelKey) {
    throw new Error(`Missing settings navigation label for page: ${definition.pageId}`)
  }

  const keywordText = [
    ...(definition.keywordKeys ?? []).map(key => t(key)),
    ...(definition.keywords ?? []),
  ]

  return {
    id: definition.id,
    pageId: definition.pageId,
    pageLabel: t(navLabelKey),
    title:
      definition.provider && definition.provider !== 'default'
        ? `${AGENT_PROVIDER_LABEL[definition.provider]} · ${t(definition.titleKey)}`
        : t(definition.titleKey),
    provider: definition.provider,
    description: definition.descriptionKey ? t(definition.descriptionKey) : undefined,
    anchorId: definition.anchorId,
    keywords: keywordText,
  }
}

function getEntryScore(entry: SettingsSearchEntry, normalizedQuery: string): number {
  // A precise control name takes precedence over every item on a matching page.
  if (normalizeSearchText(entry.title) === normalizedQuery) {
    return 110
  }
  const haystacks = [entry.title, entry.pageLabel, entry.description ?? '', ...entry.keywords]
    .map(normalizeSearchText)
    .filter(Boolean)

  if (haystacks.some(value => value === normalizedQuery)) {
    return 100
  }

  if (normalizeSearchText(entry.title).includes(normalizedQuery)) {
    return 90
  }

  if (normalizeSearchText(entry.pageLabel).includes(normalizedQuery)) {
    return 80
  }

  if (haystacks.some(value => value.includes(normalizedQuery))) {
    return 70
  }

  const terms = normalizedQuery.split(/\s+/).filter(Boolean)
  if (terms.length > 1 && terms.every(term => haystacks.some(value => value.includes(term)))) {
    return 55
  }

  return 0
}

export function createSettingsSearchEntries(options: {
  t: TranslateFn
  workspaces: WorkspaceState[]
}): SettingsSearchEntry[] {
  const { t, workspaces } = options
  const coreEntries = CORE_SEARCH_ENTRY_DEFINITIONS.filter(
    definition =>
      AI_NAMING_FEATURES.taskTitleGeneration || definition.id !== 'tasks.title-generation',
  ).map(definition => resolveEntry(definition, t))

  const workspaceEntries = workspaces.map(workspace => {
    const workspaceLabel =
      workspace.name.trim().length > 0 ? workspace.name : getFolderName(workspace.path)

    return {
      id: `workspace.${workspace.id}`,
      pageId: getWorkspacePageId(workspace.id),
      pageLabel: t('settingsPanel.nav.projects'),
      title: workspaceLabel,
      description: t('settingsPanel.workspace.searchResultDescription'),
      anchorId: `settings-section-workspace-${workspace.id}`,
      keywords: [
        workspace.path,
        t('settingsPanel.workspace.title'),
        t('settingsPanel.workspace.worktreeRootLabel'),
        t('settingsPanel.workspace.environmentVariablesTitle'),
        'project',
        'workspace',
        'worktree',
        'env',
        '项目',
        '工作区',
      ],
    }
  })

  return [...coreEntries, ...workspaceEntries]
}

export function searchSettingsEntries(
  entries: SettingsSearchEntry[],
  query: string,
): SettingsSearchResult[] {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) {
    return []
  }

  return entries
    .map(entry => ({ ...entry, score: getEntryScore(entry, normalizedQuery) }))
    .filter(entry => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.pageLabel.localeCompare(b.pageLabel) ||
        a.title.localeCompare(b.title),
    )
}
