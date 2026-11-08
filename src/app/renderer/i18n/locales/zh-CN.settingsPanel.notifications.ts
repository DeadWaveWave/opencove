export const zhCNSettingsPanelNotifications = {
  title: '通知',
  systemNotifications: {
    enabledLabel: '系统通知',
    enabledHelp: '只在 OpenCove 不在前台时发送。',
  },
  agentStandbyBanner: {
    enabledLabel: '应用内通知',
    enabledHelp: 'Agent 需要你时，在右上角显示通知卡片。',
    contextTitle: '卡片信息',
    contextHelp: '控制通知卡片中显示的上下文信息。',
    showTask: '显示任务',
    showSpace: '显示空间',
    showBranch: '显示分支',
    showPullRequest: '显示 PR',
  },
  sound: {
    enabledLabel: '提示音',
    enabledHelp: '应用内和系统通知都只响这一声。',
    choiceLabel: '音效',
    choices: {
      bit: '像素',
      tide: '潮汐',
      pebble: '卵石',
    },
    preview: '试听',
    volumeLabel: '音量',
  },
} as const
