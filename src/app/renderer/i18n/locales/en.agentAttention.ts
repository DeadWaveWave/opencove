export const enAgentAttention = {
  agentAttention: {
    /** One system notification for Agents that needed you within the same moment. */
    systemSummary: '{{count}} Agents need you',
  },
  agentActivity: {
    title: 'Agents',
    pillWaiting_one: '{{count}} agent waiting. Show agents',
    pillWaiting_other: '{{count}} agents waiting. Show agents',
    pillWorking_one: '{{count}} agent working. Show agents',
    pillWorking_other: '{{count}} agents working. Show agents',
    waiting: 'Waiting for you',
    working: 'Working',
    waitingRow: '{{title}}, {{place}}, waiting: {{waited}}',
    workingRow: '{{title}}, {{place}}, working',
  },
  agentIsland: {
    region: 'Agents that need you',
    waitingForInput: 'Waiting for your input',
    project: 'Project',
  },
} as const
