import type { SettingsPageId } from '../SettingsPanel.shared'

export interface AgentSettingsSearchEntryDefinition {
  id: string
  pageId: SettingsPageId
  pageLabelKey: string
  titleKey: string
  descriptionKey?: string
  anchorId: string
  keywordKeys?: string[]
  keywords?: string[]
}

export const AGENT_SETTINGS_SEARCH_ENTRY_DEFINITIONS: AgentSettingsSearchEntryDefinition[] = [
  {
    id: 'agent.default',
    pageId: 'agent',
    pageLabelKey: 'settingsPanel.nav.agent',
    titleKey: 'settingsPanel.agent.defaultAgentLabel',
    descriptionKey: 'settingsPanel.agent.defaultAgentHelp',
    anchorId: 'settings-default-provider',
    keywords: ['provider', 'claude', 'codex', 'gemini', 'opencode', '默认'],
  },
  {
    id: 'agent.order',
    pageId: 'agent',
    pageLabelKey: 'settingsPanel.nav.agent',
    titleKey: 'settingsPanel.agent.agentProviderOrderLabel',
    descriptionKey: 'settingsPanel.agent.agentProviderOrderHelp',
    anchorId: 'settings-section-agent',
    keywords: ['provider', 'order', 'menu', '排序'],
  },
  {
    id: 'agent.full-access',
    pageId: 'agent',
    pageLabelKey: 'settingsPanel.nav.agent',
    titleKey: 'settingsPanel.agent.fullAccessLabel',
    descriptionKey: 'settingsPanel.agent.fullAccessHelp',
    anchorId: 'settings-agent-full-access',
    keywords: ['sandbox', 'approval', 'permission', '权限', '沙箱'],
  },
  {
    id: 'agent.models',
    pageId: 'agent',
    pageLabelKey: 'settingsPanel.nav.agent',
    titleKey: 'settingsPanel.models.title',
    anchorId: 'settings-section-model-override',
    keywordKeys: [
      'settingsPanel.models.useCustomModel',
      'settingsPanel.models.addModelPlaceholder',
    ],
    keywords: ['model', 'override', '模型'],
  },
  {
    id: 'agent.env',
    pageId: 'agent',
    pageLabelKey: 'settingsPanel.nav.agent',
    titleKey: 'settingsPanel.agentEnv.title',
    descriptionKey: 'settingsPanel.agentEnv.help',
    anchorId: 'settings-section-agent-env',
    keywords: ['environment', 'env', 'variable', '环境变量'],
  },
  {
    id: 'agent.executable',
    pageId: 'agent',
    pageLabelKey: 'settingsPanel.nav.agent',
    titleKey: 'settingsPanel.agentExecutable.title',
    descriptionKey: 'settingsPanel.agentExecutable.help',
    anchorId: 'settings-section-agent-executable',
    keywords: ['path', 'binary', 'executable', 'override', '路径', '可执行文件'],
  },
]
