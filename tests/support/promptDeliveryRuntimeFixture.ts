import {
  setPromptSubmissionEvidence,
  type PromptSubmissionEvidence,
} from '../../src/shared/runtime/agentHook/claudePromptEvidence'
import type { AgentProviderId, TerminalSessionStateEvent } from '../../src/shared/contracts/dto'
import { vi } from 'vitest'
import { AgentRunStateRegistry } from '../../src/contexts/agent/application/AgentRunStateRegistry'
import { AgentRunStateRuntime } from '../../src/contexts/agent/application/AgentRunStateRuntime'
import { PromptDeliveryService } from '../../src/contexts/agent/application/PromptDeliveryService'
import type { AgentTurnArchive } from '../../src/contexts/agent/application/AgentTurnArchive'
import { PtyStreamHub } from '../../src/app/main/controlSurface/ptyStream/ptyStreamHub'

export function promptDeliveryRuntimeFixture(
  schedule = (cb: () => void, delay: number) => {
    const timer = setTimeout(cb, delay)
    return () => clearTimeout(timer)
  },
  provider: AgentProviderId = 'claude-code',
  ready = true,
  createTurnId?: () => string,
  archive?: AgentTurnArchive,
) {
  let nextTurn = 0
  const registry = new AgentRunStateRegistry({
    epoch: 'worker',
    now: Date.now,
    createTurnId: createTurnId ?? (() => (++nextTurn === 1 ? 'turn' : `turn-${nextTurn}`)),
    schedule,
    archive,
    membership: () => 'member',
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
  runtime.metadata({
    sessionId: 's',
    resumeSessionId: null,
    agentProvider: provider,
    agentLaunchKind: 'managed',
    hookCoverage: 'lifecycle',
    hookInstallState: 'installed',
  })
  hub.handlePtyData('s', '\x1b[?2004h')
  const observe = (name: string, emittedAtMs?: number, evidence?: PromptSubmissionEvidence) => {
    const event: TerminalSessionStateEvent = {
      sessionId: 's',
      source: provider === 'codex' ? 'codex_hook' : 'claude_hook',
      hookEventName: name,
      hookInstallState: 'installed',
      state: [
        'Stop',
        'StopFailure',
        'notify',
        'Notification',
        'SessionEnd',
        'turn_aborted',
      ].includes(name)
        ? 'standby'
        : name === 'PermissionRequest'
          ? 'waiting'
          : 'working',
      emittedAtMs,
    }
    if (evidence) {
      setPromptSubmissionEvidence(event, evidence)
    }
    runtime.observe(event)
  }
  if (ready) {
    observe('Stop')
  }
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
