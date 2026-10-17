export const enSettingsPanelAgent = {
  title: 'Agent',
  defaultAgentLabel: 'Default Agent',
  defaultAgentHelp: 'The default AI provider for new tasks and terminals.',
  agentListLabel: 'Agents',
  agentProviderOrderLabel: 'Agent Menu Order',
  agentProviderOrderHelp: 'The first agent is the default for new tasks and terminals.',
  reorderLabel: 'Reorder {{provider}}',
  reorderInstructions:
    'Press Space to pick up an agent, arrow keys to move, Space to drop, or Escape to cancel.',
  reorderStarted: '{{provider}} picked up at position {{position}}.',
  reorderMoved: '{{provider}} moved to position {{position}}.',
  reorderDropped: '{{provider}} dropped at position {{position}}.',
  reorderCancelled: 'Reordering {{provider}} cancelled.',
  defaultBadge: 'Default',
  configure: 'Configure',
  done: 'Done',
  envSummary_one: '{{count}} environment variable',
  envSummary_other: '{{count}} environment variables',
  envSummaryNone: 'No environment variables',
  moveUp: 'Move up',
  moveDown: 'Move down',
  fullAccessLabel: 'Full Access Mode',
  fullAccessHelp: 'Let agents leave their sandbox and act without asking for approval.',
  fullAccessOffHelp:
    'Off: agents stay in their sandbox and ask before running commands or changing files.',
  fullAccessOnHelp:
    'On: agents run commands and change files without asking. Turn this on only for projects you trust.',
} as const
