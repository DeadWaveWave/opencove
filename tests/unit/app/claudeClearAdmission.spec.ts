import { afterEach, expect, it, vi } from 'vitest'
import { createManagedClaudeClearRuntime } from '../../../src/app/main/controlSurface/managedClaudeClearRuntime'
import type { ManagedClaudeLaunchOwner } from '../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeLaunchOwner'
import type { AgentHookChannel } from '../../../src/shared/runtime/agentHook/agentHookChannel'
import type { ClaudeBindingEvidence } from '../../../src/shared/runtime/agentHook/claudeBindingEvidence'
afterEach(() => vi.unstubAllEnvs())
it.each(
  [undefined, '1', '0'].flatMap(value => [false, true].map(owned => [owned, value] as const)),
)('production producer owned=%s override=%s', (owned, value) => {
  vi.stubEnv('OPENCOVE_MANAGED_CLAUDE_BINDINGS', value)
  const tickets = owned && value !== '0' ? 1 : 0
  let observe!: (evidence: ClaudeBindingEvidence) => void
  const admission = { identity: Symbol() }
  const qualification = {
    admissionStatus: () => 'refused',
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
    if (value === '0') {
      expect(qualification.openInvocation).not.toHaveBeenCalled()
    }
  } finally {
    runtime.dispose()
  }
})
