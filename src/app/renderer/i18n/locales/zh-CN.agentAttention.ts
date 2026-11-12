export const zhCNAgentAttention = {
  agentAttention: {
    blocked: '需要你回复',
    permission: '需要批准',
    question: '有问题想问你',
    plan: '计划待审阅',
    finished: '已完成',

    /** One system notification for Agents that needed you within the same moment. */
    systemSummary: '{{count}} 个 Agent 需要你',
  },
  agentActivity: {
    title: 'Agent',
    pillWaiting_one: '{{count}} 个 Agent 需要你，查看全部',
    pillWaiting_other: '{{count}} 个 Agent 需要你，查看全部',
    pillWorking_one: '{{count}} 个 Agent 工作中，查看全部',
    pillWorking_other: '{{count}} 个 Agent 工作中，查看全部',
    waiting: '需要你',
    working: '工作中',
    attentionRow: '{{title}}，{{place}}，{{status}}',
    waitingRow: '{{title}}，{{place}}，{{status}}，{{waited}}',
    workingRow: '{{title}}，{{place}}，工作中',
  },
  agentIsland: {
    region: '需要你的 Agent',
    project: '项目',
  },
} as const
