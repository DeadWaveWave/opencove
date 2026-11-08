export const enSettingsPanelNotifications = {
  title: 'Notifications',
  systemNotifications: {
    enabledLabel: 'System notifications',
    enabledHelp: 'Sent only while OpenCove is in the background.',
  },
  agentStandbyBanner: {
    enabledLabel: 'In-app notifications',
    enabledHelp: 'Show a card at the top right when an Agent needs you.',
    contextTitle: 'Card context',
    contextHelp: 'Choose what context chips the card shows.',
    showTask: 'Show task',
    showSpace: 'Show space',
    showBranch: 'Show branch',
    showPullRequest: 'Show PR',
  },
  sound: {
    enabledLabel: 'Alert sound',
    enabledHelp: 'In-app and system notifications share this one sound.',
    choiceLabel: 'Tone',
    choices: {
      bit: 'Pixel',
      tide: 'Tide',
      pebble: 'Pebble',
    },
    preview: 'Preview',
    volumeLabel: 'Volume',
  },
} as const
