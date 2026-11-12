export const enAgentAttention = {
  agentAttention: {
    blocked: 'Needs your answer',
    permission: 'Needs approval',
    question: 'Has a question',
    plan: 'Plan ready for review',
    finished: 'Finished',

    /** One system notification for Agents that needed you within the same moment. */
    systemSummary: '{{count}} Agents need you',
  },
  agentActivity: {
    title: 'Agents',
    pillWaiting_one: '{{count}} agent needs you. Show agents',
    pillWaiting_other: '{{count}} agents need you. Show agents',
    pillWorking_one: '{{count}} agent working. Show agents',
    pillWorking_other: '{{count}} agents working. Show agents',
    waiting: 'Needs you',
    working: 'Working',
    attentionRow: '{{title}}, {{place}}, {{status}}',
    waitingRow: '{{title}}, {{place}}, {{status}}, {{waited}}',
    workingRow: '{{title}}, {{place}}, working',
  },
  agentIsland: {
    region: 'Agents that need you',
    project: 'Project',
  },
} as const
