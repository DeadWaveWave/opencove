import type { CoreSettingsSearchEntryDefinition } from './settingsSearchTypes'

type RowEntry = Omit<CoreSettingsSearchEntryDefinition, 'anchorId' | 'pageId'>

/** Rows inside one settings group: each is searchable by its own label and lands on the group. */
function rowsIn(
  pageId: CoreSettingsSearchEntryDefinition['pageId'],
  anchorId: string,
  rows: RowEntry[],
): CoreSettingsSearchEntryDefinition[] {
  return rows.map(row => ({ ...row, pageId, anchorId }))
}

export const ROW_SEARCH_ENTRY_DEFINITIONS: CoreSettingsSearchEntryDefinition[] = [
  ...rowsIn('general', 'settings-section-updates', [
    {
      id: 'general.updates.current-version',
      titleKey: 'settingsPanel.general.updates.currentVersionLabel',
      keywords: ['version', '版本'],
    },
    {
      id: 'general.updates.policy',
      titleKey: 'settingsPanel.general.updates.policyLabel',
      keywords: ['update', 'auto update', '更新'],
    },
    {
      id: 'general.updates.channel',
      titleKey: 'settingsPanel.general.updates.channelLabel',
      keywords: ['beta', 'stable', 'nightly', '通道'],
    },
    {
      id: 'general.updates.actions',
      titleKey: 'settingsPanel.general.updates.actionsLabel',
      keywords: ['check for updates', 'update', '检查更新'],
    },
    {
      id: 'general.updates.status',
      titleKey: 'settingsPanel.general.updates.statusLabel',
      keywords: ['update', 'check', '更新'],
    },
  ]),
  ...rowsIn('general', 'settings-standby-banner-context', [
    {
      id: 'general.standby-banner.task',
      titleKey: 'settingsPanel.notifications.agentStandbyBanner.showTask',
    },
    {
      id: 'general.standby-banner.space',
      titleKey: 'settingsPanel.notifications.agentStandbyBanner.showSpace',
    },
    {
      id: 'general.standby-banner.branch',
      titleKey: 'settingsPanel.notifications.agentStandbyBanner.showBranch',
    },
    {
      id: 'general.standby-banner.pull-request',
      titleKey: 'settingsPanel.notifications.agentStandbyBanner.showPullRequest',
    },
  ]),
  ...rowsIn('canvas-windows', 'settings-section-canvas-node-focus', [
    {
      id: 'canvas.focus.visible-center',
      titleKey: 'settingsPanel.canvas.focusVisibleCenterLabel',
      keywords: ['focus', 'center', '居中'],
    },
    {
      id: 'canvas.focus.target-zoom',
      titleKey: 'settingsPanel.canvas.focusTargetZoomLabel',
      keywords: ['focus', 'zoom', '缩放'],
    },
  ]),
  ...rowsIn('canvas-windows', 'settings-section-space-archiving', [
    {
      id: 'canvas.archive.delete-worktree',
      titleKey: 'settingsPanel.canvas.archiveSpaceDeleteWorktreeDefaultLabel',
      keywords: ['archive', 'worktree', '归档'],
    },
    {
      id: 'canvas.archive.delete-branch',
      titleKey: 'settingsPanel.canvas.archiveSpaceDeleteBranchDefaultLabel',
      keywords: ['archive', 'branch', '归档'],
    },
  ]),
  ...rowsIn('terminal', 'settings-section-terminal-display-calibration', [
    {
      id: 'terminal.calibration.auto-reference',
      titleKey: 'settingsPanel.general.terminalDisplayCalibration.autoReferenceLabel',
      keywords: ['calibration', '校准'],
    },
    {
      id: 'terminal.calibration.compensation',
      titleKey: 'settingsPanel.general.terminalDisplayCalibration.compensationLabel',
      keywords: ['calibration', '校准'],
    },
    {
      id: 'terminal.calibration.reference',
      titleKey: 'settingsPanel.general.terminalDisplayCalibration.referenceLabel',
      keywords: ['calibration', '校准'],
    },
    {
      id: 'terminal.calibration.diagnostics',
      titleKey: 'settingsPanel.general.terminalDisplayCalibration.diagnosticsLabel',
      descriptionKey: 'settingsPanel.general.terminalDisplayCalibration.diagnosticsHelp',
      keywords: ['calibration', 'copy', '校准', '诊断'],
    },
    {
      id: 'terminal.calibration.client',
      titleKey: 'settingsPanel.general.terminalDisplayCalibration.clientLabel',
      keywords: ['calibration', 'device', '校准'],
    },
  ]),
  ...rowsIn('worker', 'settings-section-worker-cli', [
    {
      id: 'worker.cli.status',
      titleKey: 'settingsPanel.worker.cli.statusLabel',
      keywords: ['cli', 'command line', '命令行'],
    },
    {
      id: 'worker.cli.actions',
      titleKey: 'settingsPanel.worker.cli.actionsLabel',
      keywords: ['cli', 'install', '命令行'],
    },
  ]),
  ...rowsIn('worker', 'settings-section-worker-local', [
    {
      id: 'worker.local.base-url',
      titleKey: 'settingsPanel.worker.local.baseUrlLabel',
      keywords: ['url', 'address', '地址'],
    },
    {
      id: 'worker.local.token',
      titleKey: 'settingsPanel.worker.local.tokenLabel',
      keywords: ['token', 'auth', '令牌'],
    },
  ]),
  ...rowsIn('worker', 'settings-section-worker-web-ui', [
    {
      id: 'worker.web-ui.port',
      titleKey: 'settingsPanel.experimental.workerWebUi.portLabel',
      keywords: ['port', '端口'],
    },
  ]),
  ...rowsIn('worker', 'settings-section-worker-web-ui-service', [
    {
      id: 'worker.web-ui.enabled',
      titleKey: 'settingsPanel.experimental.workerWebUi.enabledLabel',
      keywords: ['web', 'browser', '网页'],
    },
  ]),
  ...rowsIn('worker', 'settings-section-worker-web-ui-security', [
    {
      id: 'worker.web-ui.lan',
      titleKey: 'settingsPanel.experimental.workerWebUi.lanLabel',
      keywords: ['lan', 'network', '局域网'],
    },
    {
      id: 'worker.web-ui.password',
      titleKey: 'settingsPanel.experimental.workerWebUi.passwordLabel',
      keywords: ['password', '密码'],
    },
  ]),
  ...rowsIn('advanced', 'settings-section-website-windows', [
    {
      id: 'advanced.website.enabled',
      titleKey: 'settingsPanel.experimental.websiteWindowEnabledLabel',
      keywords: ['website', 'browser', '网页'],
    },
    {
      id: 'advanced.website.default-mode',
      titleKey: 'settingsPanel.experimental.websiteWindowDefaultModeLabel',
      keywords: ['website', 'open', '网页'],
    },
    {
      id: 'advanced.website.search-engine',
      titleKey: 'settingsPanel.experimental.browserSearchEngineLabel',
      keywords: ['search', 'google', 'bing', '搜索引擎'],
    },
    {
      id: 'advanced.website.paste',
      titleKey: 'settingsPanel.experimental.websiteWindowPasteLabel',
      keywords: ['paste', 'url', '粘贴'],
    },
    {
      id: 'advanced.website.max-active',
      titleKey: 'settingsPanel.experimental.websiteWindowMaxActiveLabel',
      keywords: ['website', 'memory', '网页'],
    },
    {
      id: 'advanced.website.discard-after',
      titleKey: 'settingsPanel.experimental.websiteWindowDiscardAfterLabel',
      keywords: ['website', 'memory', '网页'],
    },
  ]),
  ...rowsIn('advanced', 'settings-section-diagnostics', [
    {
      id: 'advanced.diagnostics.header-monitor',
      titleKey: 'settingsPanel.diagnostics.headerMonitor.label',
      keywords: ['performance', 'monitor', '性能'],
    },
  ]),
]
