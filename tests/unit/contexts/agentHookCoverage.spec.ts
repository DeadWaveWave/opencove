import { expect, it } from 'vitest'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { AgentRunStateRuntime } from '../../../src/contexts/agent/application/AgentRunStateRuntime'
import { TerminalAgentInvocationRegistry } from '../../../src/contexts/agent/application/TerminalAgentInvocationRegistry'
import { projectPtyStreamAgentMetadata } from '../../../src/shared/runtime/terminalSessionMetadataProjection'
import type { TerminalSessionMetadataEvent } from '../../../src/shared/contracts/dto'

it('carries invocation coverage through metadata projection to fences; hooks cannot upgrade it and replacements reset it', () => {
  const registry = new AgentRunStateRegistry({
    epoch: 'e',
    now: () => 1,
    createTurnId: () => 't',
    schedule: () => () => {},
  })
  const runtime = new AgentRunStateRuntime(registry, () => 1)
  const invocations = new TerminalAgentInvocationRegistry()
  let projected: TerminalSessionMetadataEvent | null = null
  invocations.onMetadata(event => {
    projected = projectPtyStreamAgentMetadata(projected, event)!
    runtime.metadata(projected)
  })
  const terminal = invocations.reserve({ sourceId: 'test' })
  terminal.bind('s')
  const first = terminal.beginInvocation({
    invocationId: 'first',
    provider: 'codex',
    hookCoverage: 'notify_only',
    hookInstallState: 'installed',
  })!
  expect(invocations.list().entries[0]).toMatchObject({ hookCoverage: 'notify_only' })
  expect(registry.readFence({ sessionId: 's' })).toMatchObject({
    hookCoverage: 'notify_only',
    hookInstallState: 'installed',
  })
  runtime.observe({
    sessionId: 's',
    source: 'codex_hook',
    state: 'standby',
    hookEventName: 'Stop',
    hookInstallState: 'installed',
  })
  expect(registry.readFence({ sessionId: 's' })?.hookCoverage).toBe('notify_only')
  // Hook identity metadata does not carry launch coverage; the projection must retain it.
  const identity = projectPtyStreamAgentMetadata(projected, {
    sessionId: 's',
    resumeSessionId: 'provider-s',
    agentProvider: 'codex',
  })
  if (identity) {
    runtime.metadata(identity)
  }
  expect(registry.readFence({ sessionId: 's' })?.hookCoverage).toBe('notify_only')
  const before = registry.readFence({ sessionId: 's' })!
  terminal.beginInvocation({
    invocationId: 'second',
    provider: 'codex',
    hookCoverage: 'lifecycle',
    hookInstallState: 'installed',
  })
  expect(first.isCurrent()).toBe(false)
  expect(registry.readFence({ sessionId: 's' })).toMatchObject({
    hookCoverage: 'lifecycle',
    watermarks: {},
  })
  expect(registry.readFence({ sessionId: 's' })!.incarnation).not.toBe(before.incarnation)
  terminal.beginInvocation({ invocationId: 'legacy', provider: 'codex' })
  expect(registry.readFence({ sessionId: 's' })?.hookCoverage).toBeUndefined()
  terminal.release()
  runtime.dispose()
})

it("does not inherit a different provider's coverage from legacy metadata without an invocation ID", () => {
  const projected = projectPtyStreamAgentMetadata(
    {
      sessionId: 's',
      resumeSessionId: null,
      agentProvider: 'claude-code',
      hookCoverage: 'lifecycle',
      hookInstallState: 'installed',
    },
    { sessionId: 's', resumeSessionId: null, agentProvider: 'codex' },
  )!
  expect(projected.agentProvider).toBe('codex')
  expect(projected.hookCoverage).toBeUndefined()
  expect(projected.hookInstallState).toBeUndefined()
})
