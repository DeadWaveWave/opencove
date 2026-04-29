import type { TranslateFn } from '@app/renderer/i18n'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { getFolderName, getWorkspacePageId, type SettingsPageId } from '../SettingsPanel.shared'

export interface SettingsSearchEntry {
  id: string
  pageId: SettingsPageId
  pageLabel: string
  title: string
  description?: string
  anchorId: string
  keywords: string[]
}

export interface SettingsSearchResult extends SettingsSearchEntry {
  score: number
}

interface CoreSettingsSearchEntryDefinition {
  id: string
  pageId: SettingsPageId
  pageLabelKey: string
  titleKey: string
  descriptionKey?: string
  anchorId: string
  keywordKeys?: string[]
  keywords?: string[]
}

const CORE_SEARCH_ENTRY_DEFINITIONS: CoreSettingsSearchEntryDefinition[] = [
  {
    id: 'general.language',
    pageId: 'general',
    pageLabelKey: 'settingsPanel.nav.general',
    titleKey: 'settingsPanel.general.languageLabel',
    descriptionKey: 'settingsPanel.general.languageHelp',
    anchorId: 'settings-language',
    keywords: ['display', 'locale', '中文', '语言'],
  },
  {
    id: 'general.theme',
    pageId: 'general',
    pageLabelKey: 'settingsPanel.nav.general',
    titleKey: 'settingsPanel.general.uiThemeLabel',
    descriptionKey: 'settingsPanel.general.uiThemeHelp',
    anchorId: 'settings-ui-theme',
    keywords: ['theme', 'dark', 'light', 'appearance', '外观', '主题'],
  },
  {
    id: 'general.ui-font-size',
    pageId: 'general',
    pageLabelKey: 'settingsPanel.nav.general',
    titleKey: 'settingsPanel.general.interfaceFontSize',
    anchorId: 'settings-ui-font-size',
    keywords: ['font', 'size', 'interface', '字体', '界面'],
  },
  {
    id: 'general.terminal-font-size',
    pageId: 'general',
    pageLabelKey: 'settingsPanel.nav.general',
    titleKey: 'settingsPanel.general.terminalFontSize',
    anchorId: 'settings-terminal-font-size',
    keywords: ['font', 'size', 'terminal', '终端', '字体'],
  },
  {
    id: 'general.terminal-font-family',
    pageId: 'general',
    pageLabelKey: 'settingsPanel.nav.general',
    titleKey: 'settingsPanel.general.terminalFontFamily',
    anchorId: 'settings-terminal-font-family',
    keywords: ['font', 'family', 'terminal', 'shell', '终端', '字体'],
  },
  {
    id: 'general.terminal-display-calibration',
    pageId: 'general',
    pageLabelKey: 'settingsPanel.nav.general',
    titleKey: 'settingsPanel.general.terminalDisplayCalibration.title',
    descriptionKey: 'settingsPanel.general.terminalDisplayCalibration.help',
    anchorId: 'settings-section-terminal-display-calibration',
    keywords: ['terminal', 'display', 'calibration', 'web ui', 'desktop', '终端', '校准'],
  },
  {
    id: 'general.updates',
    pageId: 'general',
    pageLabelKey: 'settingsPanel.nav.general',
    titleKey: 'settingsPanel.general.updates.title',
    descriptionKey: 'settingsPanel.general.updates.help',
    anchorId: 'settings-section-updates',
    keywordKeys: [
      'settingsPanel.general.updates.policyLabel',
      'settingsPanel.general.updates.channelLabel',
      'settingsPanel.general.updates.statusLabel',
    ],
    keywords: ['release', 'version', 'auto update', '更新', '版本'],
  },
  {
    id: 'worker.home',
    pageId: 'worker',
    pageLabelKey: 'settingsPanel.nav.worker',
    titleKey: 'settingsPanel.worker.home.title',
    descriptionKey: 'settingsPanel.worker.home.help',
    anchorId: 'settings-section-worker-home',
    keywordKeys: ['settingsPanel.worker.home.modeLabel'],
    keywords: ['worker', 'local', 'remote', 'standalone', 'durable state'],
  },
  {
    id: 'worker.cli',
    pageId: 'worker',
    pageLabelKey: 'settingsPanel.nav.worker',
    titleKey: 'settingsPanel.worker.cli.title',
    descriptionKey: 'settingsPanel.worker.cli.help',
    anchorId: 'settings-section-worker-cli',
    keywordKeys: ['settingsPanel.worker.cli.install', 'settingsPanel.worker.cli.uninstall'],
    keywords: ['opencove', 'path', 'command line', '命令行'],
  },
  {
    id: 'worker.local',
    pageId: 'worker',
    pageLabelKey: 'settingsPanel.nav.worker',
    titleKey: 'settingsPanel.worker.local.title',
    descriptionKey: 'settingsPanel.worker.local.help',
    anchorId: 'settings-section-worker-local',
    keywords: ['127.0.0.1', 'token', 'base url', '本地'],
  },
  {
    id: 'endpoints.list',
    pageId: 'endpoints',
    pageLabelKey: 'settingsPanel.nav.endpoints',
    titleKey: 'settingsPanel.endpoints.list.title',
    descriptionKey: 'settingsPanel.endpoints.list.help',
    anchorId: 'settings-section-endpoints',
    keywordKeys: ['settingsPanel.endpoints.actions.add', 'settingsPanel.endpoints.actions.ping'],
    keywords: ['remote worker', 'register', 'endpoint', '远程'],
  },
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
    id: 'notifications.standby-banner',
    pageId: 'notifications',
    pageLabelKey: 'settingsPanel.nav.notifications',
    titleKey: 'settingsPanel.notifications.agentStandbyBanner.enabledLabel',
    descriptionKey: 'settingsPanel.notifications.agentStandbyBanner.enabledHelp',
    anchorId: 'settings-section-notifications',
    keywordKeys: [
      'settingsPanel.notifications.agentStandbyBanner.contextTitle',
      'settingsPanel.notifications.agentStandbyBanner.showTask',
      'settingsPanel.notifications.agentStandbyBanner.showSpace',
      'settingsPanel.notifications.agentStandbyBanner.showBranch',
      'settingsPanel.notifications.agentStandbyBanner.showPullRequest',
    ],
    keywords: ['banner', 'standby', 'notification', '通知', '横幅'],
  },
  {
    id: 'notifications.system-notifications',
    pageId: 'notifications',
    pageLabelKey: 'settingsPanel.nav.notifications',
    titleKey: 'settingsPanel.notifications.systemNotifications.enabledLabel',
    descriptionKey: 'settingsPanel.notifications.systemNotifications.enabledHelp',
    anchorId: 'settings-section-notifications',
    keywords: ['system', 'native', 'notification', '通知', '系统通知'],
  },
  {
    id: 'canvas.input-mode',
    pageId: 'canvas',
    pageLabelKey: 'settingsPanel.nav.canvas',
    titleKey: 'settingsPanel.canvas.inputModeLabel',
    descriptionKey: 'settingsPanel.canvas.inputModeHelp',
    anchorId: 'settings-canvas-input-mode',
    keywordKeys: [
      'settingsPanel.canvas.inputMode.auto',
      'settingsPanel.canvas.inputMode.trackpad',
      'settingsPanel.canvas.inputMode.mouse',
    ],
    keywords: ['trackpad', 'mouse', 'interaction', '触控板', '鼠标'],
  },
  {
    id: 'canvas.wheel',
    pageId: 'canvas',
    pageLabelKey: 'settingsPanel.nav.canvas',
    titleKey: 'settingsPanel.canvas.wheelBehaviorLabel',
    descriptionKey: 'settingsPanel.canvas.wheelBehaviorHelp',
    anchorId: 'settings-canvas-wheel-behavior',
    keywordKeys: [
      'settingsPanel.canvas.wheelBehavior.zoom',
      'settingsPanel.canvas.wheelBehavior.pan',
      'settingsPanel.canvas.wheelZoomModifierLabel',
      'settingsPanel.canvas.wheelZoomModifierHelp',
    ],
    keywords: ['scroll', 'zoom', 'pan', 'wheel', '滚轮', '缩放', '平移'],
  },
  {
    id: 'canvas.window-size',
    pageId: 'canvas',
    pageLabelKey: 'settingsPanel.nav.canvas',
    titleKey: 'settingsPanel.canvas.standardWindowSizeLabel',
    descriptionKey: 'settingsPanel.canvas.standardWindowSizeHelp',
    anchorId: 'settings-standard-window-size',
    keywords: ['window', 'size', 'arrange', '窗口', '大小'],
  },
  {
    id: 'canvas.terminal-profile',
    pageId: 'canvas',
    pageLabelKey: 'settingsPanel.nav.canvas',
    titleKey: 'settingsPanel.canvas.terminalProfileLabel',
    descriptionKey: 'settingsPanel.canvas.terminalProfileHelp',
    anchorId: 'settings-terminal-profile',
    keywords: ['shell', 'terminal', 'profile', '终端'],
  },
  {
    id: 'canvas.focus',
    pageId: 'canvas',
    pageLabelKey: 'settingsPanel.nav.canvas',
    titleKey: 'settingsPanel.canvas.focusOnClickLabel',
    descriptionKey: 'settingsPanel.canvas.focusOnClickHelp',
    anchorId: 'settings-focus-node-on-click',
    keywordKeys: [
      'settingsPanel.canvas.focusVisibleCenterLabel',
      'settingsPanel.canvas.focusTargetZoomLabel',
      'settingsPanel.canvas.focusTargetZoomHelp',
    ],
    keywords: ['focus', 'center', 'zoom', 'node', '聚焦', '居中'],
  },
  {
    id: 'experimental.remote-workers',
    pageId: 'experimental',
    pageLabelKey: 'settingsPanel.nav.experimental',
    titleKey: 'settingsPanel.experimental.remoteWorkersTitle',
    descriptionKey: 'settingsPanel.experimental.remoteWorkersHelp',
    anchorId: 'settings-section-experimental-remote-workers',
    keywordKeys: ['settingsPanel.experimental.remoteWorkersEnabledLabel'],
    keywords: ['remote', 'worker', 'location', 'experimental', '远程'],
  },
  {
    id: 'experimental.worker-web-ui',
    pageId: 'experimental',
    pageLabelKey: 'settingsPanel.nav.experimental',
    titleKey: 'settingsPanel.experimental.workerWebUi.title',
    descriptionKey: 'settingsPanel.experimental.workerWebUi.help',
    anchorId: 'settings-section-worker-web-ui',
    keywordKeys: [
      'settingsPanel.experimental.workerWebUi.enabledLabel',
      'settingsPanel.experimental.workerWebUi.portLabel',
      'settingsPanel.experimental.workerWebUi.lanLabel',
      'settingsPanel.experimental.workerWebUi.passwordLabel',
    ],
    keywords: ['web ui', 'browser', 'lan', 'password', '网页', '局域网'],
  },
  {
    id: 'experimental.website-windows',
    pageId: 'experimental',
    pageLabelKey: 'settingsPanel.nav.experimental',
    titleKey: 'settingsPanel.experimental.websiteWindowsTitle',
    descriptionKey: 'settingsPanel.experimental.websiteWindowsHelp',
    anchorId: 'settings-section-website-windows',
    keywordKeys: [
      'settingsPanel.experimental.websiteWindowEnabledLabel',
      'settingsPanel.experimental.websiteWindowPasteLabel',
      'settingsPanel.experimental.websiteWindowMaxActiveLabel',
      'settingsPanel.experimental.websiteWindowKeepAliveHostsLabel',
    ],
    keywords: ['website', 'webview', 'paste', 'keep alive', '网页', '粘贴'],
  },
  {
    id: 'shortcuts.disable-terminal',
    pageId: 'shortcuts',
    pageLabelKey: 'settingsPanel.nav.shortcuts',
    titleKey: 'settingsPanel.shortcuts.disableWhenTerminalFocusedLabel',
    descriptionKey: 'settingsPanel.shortcuts.disableWhenTerminalFocusedHelp',
    anchorId: 'settings-disable-shortcuts-terminal-focused',
    keywords: ['shortcut', 'terminal', 'focused', '快捷键', '终端'],
  },
  {
    id: 'shortcuts.bindings',
    pageId: 'shortcuts',
    pageLabelKey: 'settingsPanel.nav.shortcuts',
    titleKey: 'settingsPanel.shortcuts.bindings',
    descriptionKey: 'settingsPanel.shortcuts.bindingsHelp',
    anchorId: 'settings-section-keybindings',
    keywords: ['keybinding', 'hotkey', 'record', '快捷键'],
  },
  {
    id: 'quick-menu.commands',
    pageId: 'quick-menu',
    pageLabelKey: 'settingsPanel.nav.quickMenu',
    titleKey: 'settingsPanel.quickMenu.commands.title',
    descriptionKey: 'settingsPanel.quickMenu.commands.help',
    anchorId: 'settings-section-quick-commands',
    keywordKeys: [
      'settingsPanel.quickMenu.commands.commandLabel',
      'settingsPanel.quickMenu.commands.urlLabel',
      'settingsPanel.quickMenu.commands.pinned',
    ],
    keywords: ['context menu', 'command', 'url', '右键', '命令'],
  },
  {
    id: 'quick-menu.phrases',
    pageId: 'quick-menu',
    pageLabelKey: 'settingsPanel.nav.quickMenu',
    titleKey: 'settingsPanel.quickMenu.phrases.title',
    descriptionKey: 'settingsPanel.quickMenu.phrases.help',
    anchorId: 'settings-section-quick-phrases',
    keywordKeys: ['settingsPanel.quickMenu.phrases.contentLabel'],
    keywords: ['phrase', 'snippet', 'insert', '短语'],
  },
  {
    id: 'tasks.title-generation',
    pageId: 'task-configuration',
    pageLabelKey: 'settingsPanel.nav.tasks',
    titleKey: 'settingsPanel.tasks.titleProviderLabel',
    descriptionKey: 'settingsPanel.tasks.titleProviderHelp',
    anchorId: 'settings-task-title-provider',
    keywordKeys: [
      'settingsPanel.tasks.titleModelLabel',
      'settingsPanel.tasks.effectiveProviderLabel',
    ],
    keywords: ['task title', 'ai naming', '任务', '标题'],
  },
  {
    id: 'tasks.tags',
    pageId: 'task-configuration',
    pageLabelKey: 'settingsPanel.nav.tasks',
    titleKey: 'settingsPanel.tasks.tagsLabel',
    descriptionKey: 'settingsPanel.tasks.tagsHelp',
    anchorId: 'settings-section-task-tags',
    keywords: ['tag', 'category', 'filter', '标签'],
  },
  {
    id: 'integrations.github-prs',
    pageId: 'integrations',
    pageLabelKey: 'settingsPanel.nav.integrations',
    titleKey: 'settingsPanel.integrations.githubPullRequestsLabel',
    descriptionKey: 'settingsPanel.integrations.githubPullRequestsHelp',
    anchorId: 'settings-github-pull-requests',
    keywords: ['github', 'pull request', 'pr', 'gh', '集成'],
  },
]

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function resolveEntry(
  definition: CoreSettingsSearchEntryDefinition,
  t: TranslateFn,
): SettingsSearchEntry {
  const keywordText = [
    ...(definition.keywordKeys ?? []).map(key => t(key)),
    ...(definition.keywords ?? []),
  ]

  return {
    id: definition.id,
    pageId: definition.pageId,
    pageLabel: t(definition.pageLabelKey),
    title: t(definition.titleKey),
    description: definition.descriptionKey ? t(definition.descriptionKey) : undefined,
    anchorId: definition.anchorId,
    keywords: keywordText,
  }
}

function getEntryScore(entry: SettingsSearchEntry, normalizedQuery: string): number {
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
  endpointsEnabled: boolean
}): SettingsSearchEntry[] {
  const { t, workspaces, endpointsEnabled } = options
  const coreEntries = CORE_SEARCH_ENTRY_DEFINITIONS.filter(
    definition => endpointsEnabled || definition.pageId !== 'endpoints',
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
