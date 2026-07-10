import type { StaticSettingsPageId } from './settingsPageRegistry'

export interface AgentSettingsSearchEntryDefinition {
  id: string
  pageId: StaticSettingsPageId
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
    titleKey: 'settingsPanel.agent.defaultAgentLabel',
    descriptionKey: 'settingsPanel.agent.defaultAgentHelp',
    anchorId: 'settings-agent-list',
    keywords: ['provider', 'claude', 'codex', 'gemini', 'opencode', '默认'],
  },
  {
    id: 'agent.order',
    pageId: 'agent',
    titleKey: 'settingsPanel.agent.agentProviderOrderLabel',
    descriptionKey: 'settingsPanel.agent.agentProviderOrderHelp',
    anchorId: 'settings-agent-list',
    keywords: ['provider', 'order', 'menu', '排序'],
  },
  {
    id: 'agent.full-access',
    pageId: 'agent',
    titleKey: 'settingsPanel.agent.fullAccessLabel',
    descriptionKey: 'settingsPanel.agent.fullAccessHelp',
    anchorId: 'settings-agent-full-access',
    keywords: ['sandbox', 'approval', 'permission', '权限', '沙箱'],
  },
  {
    id: 'agent.models',
    pageId: 'agent',
    titleKey: 'settingsPanel.models.title',
    descriptionKey: 'settingsPanel.agent.agentProviderOrderHelp',
    anchorId: 'settings-agent-list',
    keywordKeys: [
      'settingsPanel.models.useCustomModel',
      'settingsPanel.models.addModelPlaceholder',
    ],
    keywords: ['model', 'override', '模型'],
  },
  {
    id: 'agent.env',
    pageId: 'agent',
    titleKey: 'settingsPanel.agentEnv.title',
    descriptionKey: 'settingsPanel.agentEnv.help',
    anchorId: 'settings-agent-list',
    keywords: ['environment', 'env', 'variable', '环境变量'],
  },
  {
    id: 'agent.executable',
    pageId: 'agent',
    titleKey: 'settingsPanel.agent.agentListLabel',
    descriptionKey: 'settingsPanel.agentExecutable.help',
    anchorId: 'settings-agent-list',
    keywords: ['install', 'binary', 'executable', 'npm', '安装', '可执行文件'],
  },
]
