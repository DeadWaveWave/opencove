import { identityFixture, node } from './cliIdentity.helpers'
export const task = {
  ...node,
  id: 'task',
  kind: 'task',
  data: { kind: 'task', linkedAgentNodeId: 'agent' },
}
export const agent = { ...node, id: 'agent', kind: 'agent', sessionId: 's' }
const observed = { ...node, id: 'observed', sessionId: 'observed-s' }
export function fixture() {
  const f = identityFixture(false)
  f.values['node.list'] = { nodes: [task, agent, observed] }
  f.values['agent.list'] = {
    agents: [
      { nodeId: 'agent', sessionId: 's', state: 'idle', quality: 'authoritative', turn: null },
      {
        nodeId: 'observed',
        sessionId: 'observed-s',
        state: 'working',
        quality: 'authoritative',
        turn: { id: 'turn' },
      },
    ],
  }
  return f
}
