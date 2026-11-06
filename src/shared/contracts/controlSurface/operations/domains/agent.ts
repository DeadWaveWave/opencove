import { defineLegacyOperation } from '../defineOperation'
export const agentListSessionsOperation = defineLegacyOperation({
  id: 'agent.listSessions',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List saved agent conversations in an approved working directory',
})
export const agentOperations = [agentListSessionsOperation] as const
