import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { StaticSettingsPageId } from './settingsPageRegistry'

export interface CoreSettingsSearchEntryDefinition {
  id: string
  pageId: StaticSettingsPageId
  titleKey: string
  descriptionKey?: string
  anchorId: string
  keywordKeys?: string[]
  keywords?: string[]
  provider?: AgentProvider | 'default'
}
