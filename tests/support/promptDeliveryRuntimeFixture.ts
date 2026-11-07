import { vi } from 'vitest'
import { AgentRunStateRegistry } from '../../src/contexts/agent/application/AgentRunStateRegistry'
import { AgentRunStateRuntime } from '../../src/contexts/agent/application/AgentRunStateRuntime'
import { PromptDeliveryService } from '../../src/contexts/agent/application/PromptDeliveryService'
import { PtyStreamHub } from '../../src/app/main/controlSurface/ptyStream/ptyStreamHub'

export function promptDeliveryRuntimeFixture(
  schedule = (cb: () => void, delay: number) => {
    const timer = setTimeout(cb, delay)
    return () => clearTimeout(timer)
  },
) {
  const registry = new AgentRunStateRegistry({
    epoch: 'worker',
    now: Date.now,
    createTurnId: () => 'turn',
    schedule,
  })
  const runtime = new AgentRunStateRuntime(registry, Date.now)
  runtime.setBindings([{ sessionId: 's', nodeId: 'n', projectId: 'p', remote: false }])
  const write = vi.fn()
  const hub = new PtyStreamHub({
    agentRuns: runtime,
    replayWindowMaxBytes: 64000,
    ptyRuntime: {
      write,
      spawnSession: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: () => () => {},
      onExit: () => () => {},
    },
  })
  runtime.metadata({ sessionId: 's', resumeSessionId: null, agentProvider: 'claude-code' })
  hub.handlePtyData('s', '\x1b[?2004h')
  const observe = (name: string, emittedAtMs?: number) =>
    runtime.observe({
      sessionId: 's',
      source: 'claude_hook',
      hookEventName: name,
      hookInstallState: 'installed',
      state: name === 'Stop' ? 'standby' : 'working',
      emittedAtMs,
    })
  observe('Stop')
  const service = new PromptDeliveryService({
    runs: registry,
    input: hub,
    now: Date.now,
    createDeliveryId: () => 'd',
    schedule,
    capability: () => ({ supported: true, submitDelayMs: 300 }),
  })
  return {
    registry,
    runtime,
    hub,
    write,
    observe,
    service,
    deliver: (caller = {}, timeoutMs = 15000) =>
      service.deliver({ nodeId: 'n', text: 'prompt', timeoutMs }, caller),
    dispose: () => {
      service.dispose()
      hub.forgetSession('s')
      runtime.dispose()
    },
  }
}
