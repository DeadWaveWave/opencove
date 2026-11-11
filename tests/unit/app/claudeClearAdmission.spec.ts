import { afterEach, expect, it, vi } from 'vitest'
import { createManagedClaudeClearRuntime } from '../../../src/app/main/controlSurface/managedClaudeClearRuntime'
import type { ManagedClaudeLaunchOwner } from '../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeLaunchOwner'
import type { AgentHookChannel } from '../../../src/shared/runtime/agentHook/agentHookChannel'
import type { ClaudeBindingEvidence } from '../../../src/shared/runtime/agentHook/claudeBindingEvidence'
afterEach(() => vi.unstubAllEnvs())
it.each([
  [false, false, true, 0],
  [false, true, true, 0],
  [true, false, true, 0],
  [true, true, true, 1],
  [true, true, false, 0],
])('production gates owned=%s experimental=%s writes=%s', (owned, enabled, writes, tickets) => {
  vi.stubEnv('OPENCOVE_EXPERIMENTAL_MANAGED_CLAUDE_BINDINGS', enabled ? '1' : '0')
  vi.stubEnv('OPENCOVE_MANAGED_CLAUDE_BINDINGS', writes ? '1' : '0')
  let observe!: (evidence: ClaudeBindingEvidence) => void
  const admission = { identity: Symbol() }
  const qualification = {
    openInvocation: vi.fn(() => (owned ? admission : null)),
    beginQualification: vi.fn(() => null),
    closeInvocation: vi.fn(),
  }
  const runtime = createManagedClaudeClearRuntime(
    [
      {
        onClaudeBindingEvidence: listener => {
          observe = listener
          return () => {}
        },
      } as AgentHookChannel,
    ],
    { qualification } as unknown as ManagedClaudeLaunchOwner,
  )
  const credential = {},
    at = Date.now()
  try {
    for (const [index, name] of ['SessionStart', 'UserPromptSubmit', 'Stop'].entries()) {
      observe({
        sessionId: 'r',
        credential,
        incarnation: 'r',
        isCurrent: () => true,
        configDirectories: [],
        action: index === 0 ? 'start' : 'event',
        event: {
          hookEventName: name,
          claudeSessionId: 'B',
          emittedAtMs: at + index,
          sessionStartSource: 'clear',
          promptId: 'p',
          transcriptPath: '/B.jsonl',
        },
      })
    }
    expect(qualification.beginQualification).toHaveBeenCalledTimes(Number(tickets))
    if (!enabled || !writes) {
      expect(qualification.openInvocation).not.toHaveBeenCalled()
    }
  } finally {
    runtime.dispose()
  }
})
