// @vitest-environment node
import { expect, it } from 'vitest'
import { RemoteAgentRunMirror } from '../../../src/app/main/controlSurface/ptyStream/remoteAgentRunMirror'
import { AgentRunStateRuntime } from '../../../src/contexts/agent/application/AgentRunStateRuntime'
import { registryWaitFixture } from './agentWaitRegistry.helpers'
import { snapshot } from './cliAgentWait.helpers'

// Residual protocol limit: the Home cursor does not certify remote agent.ready.
it('documents attention from a Home snapshot populated by remote replay before ready', async () => {
  const f = registryWaitFixture()
  const runtime = new AgentRunStateRuntime(f.registry, () => 100)
  runtime.metadata({
    sessionId: 's',
    agentProvider: 'claude-code',
    resumeSessionId: null,
    remote: true,
  })
  runtime.setBindings([{ sessionId: 's', nodeId: 'n', projectId: 'p', remote: true }])
  const mirror = new RemoteAgentRunMirror({
    sessions: () => ['remote'],
    reconnect: () => {},
    emit: (_id, event) => runtime.observe({ ...event, sessionId: 's' }),
  })
  const frame = (value: unknown) => mirror.handleMessage(JSON.stringify(value))
  try {
    frame({ type: 'hello_ack', capabilities: { agentRunEvents: 1 } })
    frame({ type: 'agent.baseline', epoch: 'remote', seq: 0, agents: [] })
    frame({ type: 'agent.ready', epoch: 'remote', seq: 0 })
    mirror.disconnect()
    frame({ type: 'hello_ack', capabilities: { agentRunEvents: 1 } })
    frame({
      type: 'agent.event',
      event: {
        type: 'agent.state_changed',
        epoch: 'remote',
        seq: 1,
        snapshot: {
          ...snapshot('remote', 'waiting'),
          sessionId: 'remote',
          blockedReason: 'permission',
        },
      },
    })
    expect(f.registry.get({ nodeId: 'n' })).toMatchObject({
      state: 'waiting',
      quality: 'authoritative',
    })
    await expect(f.wait()).rejects.toMatchObject({ exitCode: 10 })
    // No agent.ready for the reconnect has been received at the decision point.
  } finally {
    runtime.dispose()
  }
})
