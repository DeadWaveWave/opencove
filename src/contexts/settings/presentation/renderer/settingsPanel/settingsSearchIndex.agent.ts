import { SELECTABLE_AGENT_PROVIDERS } from '@contexts/settings/domain/agentSettings'
import type { CoreSettingsSearchEntryDefinition } from './settingsSearchTypes'

export type AgentSettingsSearchEntryDefinition = CoreSettingsSearchEntryDefinition
const DETAILS = [
  {
    kind: 'models',
    titleKey: 'settingsPanel.models.title',
    anchor: 'models',
    keywords: ['model', 'override', '模型'],
  },
  {
    kind: 'env',
    titleKey: 'settingsPanel.agentEnv.title',
    anchor: 'env',
    keywords: ['environment', 'env', 'variable', '环境变量'],
  },
  {
    kind: 'executable',
    titleKey: 'settingsPanel.agentDetail.runtime',
    anchor: 'runtime',
    keywords: ['install', 'binary', 'executable', 'npm', '安装', '可执行文件'],
  },
] as const

export const AGENT_SETTINGS_SEARCH_ENTRY_DEFINITIONS: AgentSettingsSearchEntryDefinition[] = [
  {
    id: 'agent.default',
    pageId: 'agent',
    titleKey: 'settingsPanel.agent.defaultAgentLabel',
    descriptionKey: 'settingsPanel.agent.defaultAgentHelp',
    anchorId: 'settings-agent-list',
    keywords: ['provider', 'claude', 'codex', 'opencode', '默认'],
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
  ...DETAILS.map(detail => ({
    id: `agent.${detail.kind}`,
    pageId: 'agent' as const,
    titleKey: detail.titleKey,
    anchorId: `settings-agent-${detail.anchor}-{provider}`,
    provider: 'default' as const,
    keywords: [...detail.keywords],
  })),
  ...SELECTABLE_AGENT_PROVIDERS.flatMap(provider =>
    DETAILS.map(detail => ({
      id: `agent.${provider}.${detail.kind}`,
      pageId: 'agent' as const,
      titleKey: detail.titleKey,
      anchorId: `settings-agent-${detail.anchor}-${provider}`,
      provider,
      keywords: [provider, ...detail.keywords],
    })),
  ),
]
