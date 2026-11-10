import { identityFixture, node } from './cliIdentity.helpers'
import { snapshot } from './cliAgentWait.helpers'

export function completedPromptFixture() {
  const f = identityFixture(false)
  f.values['system.operation.describe'] = { inputSchema: { properties: { whenBusy: {} } } }
  f.values['agent.prompt'] = {
    nodeId: node.id,
    sessionId: 's',
    deliveryId: 'd',
    turnId: 't',
    phase: 'submission_observed',
    textComparison: 'unavailable',
  }
  f.values['agent.delivery.get'] = {
    available: true,
    nodeId: node.id,
    sessionId: 's',
    deliveryId: 'd',
    turnId: 't',
    status: 'submitted',
    epoch: 'e',
    incarnation: 'i',
    mode: 'turn',
    evidenceWindow: 'closed',
    createdAt: 1,
  }
  f.values['agent.list'] = { epoch: 'e', seq: 20, turnArchive: true, agents: [] }
  f.values['agent.get'] = {
    ...snapshot(node.id, 'idle'),
    sessionId: 's',
    lastEndedTurn: { id: 't', endedAt: 10, outcome: 'completed' },
  }
  f.values['agent.finalMessage'] = {
    nodeId: node.id,
    sessionId: 's',
    turnId: 't',
    message: 'Fast reply',
    outcome: 'completed',
    endedAt: 10,
    source: 'hook',
    persisted: true,
    truncated: false,
  }
  return f
}
