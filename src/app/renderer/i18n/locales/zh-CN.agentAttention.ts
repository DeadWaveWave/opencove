export const zhCNAgentAttention = {
  agentAttention: {
    /** One system notification for Agents that needed you within the same moment. */
    systemSummary: '{{count}} 个 Agent 等待你',
  },
  agentActivity: {
    title: 'Agent',
    pillWaiting_one: '{{count}} 个 Agent 在等你，查看全部',
    pillWaiting_other: '{{count}} 个 Agent 在等你，查看全部',
    pillWorking_one: '{{count}} 个 Agent 工作中，查看全部',
    pillWorking_other: '{{count}} 个 Agent 工作中，查看全部',
    waiting: '等待你',
    working: '工作中',
    waitingRow: '{{title}}，{{place}}，等待：{{waited}}',
    workingRow: '{{title}}，{{place}}，工作中',
  },
  agentIsland: {
    region: '需要你的 Agent',
    waitingForInput: '等待你的输入',
    project: '项目',
  },
} as const
