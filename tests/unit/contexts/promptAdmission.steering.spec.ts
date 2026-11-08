import { expect, it } from 'vitest'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'
import type { RunStateFence } from '../../../src/contexts/agent/application/ports/PromptDeliveryPorts'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'
const capability = () => ({ supported: true as const, submitDelayMs: 300 })
it.each(['claude-code', 'codex'] as const)(
  '%s admits only authoritative local managed lifecycle steering',
  provider => {
    const f = promptDeliveryRuntimeFixture(undefined, provider)
    try {
      f.observe('UserPromptSubmit', Date.now(), { promptId: 'active' })
      const base = f.registry.readFence({ nodeId: 'n' })!
      expect(promptAdmission(base, capability, 'steer')).toBeNull()
      for (const policy of [undefined, 'refuse'] as const) {
        expect(promptAdmission(base, capability, policy)).toMatchObject({ code: 'agent.busy' })
      }
      const cases: [Partial<RunStateFence>, Partial<RunStateFence['snapshot']>, string][] = [
        [{ remote: true }, {}, 'agent.prompt_unsupported'],
        [{ launchKind: 'terminal' }, {}, 'agent.prompt_unsupported'],
        [{ launchKind: undefined }, {}, 'agent.prompt_unsupported'],
        [{ hookCoverage: 'unverified_executable' }, {}, 'agent.prompt_unsupported'],
        [{ hookCoverage: 'none' }, {}, 'agent.prompt_unsupported'],
        [{}, { quality: 'degraded' }, 'agent.state_unknown'],
        [{}, { quality: 'inferred' }, 'agent.state_unknown'],
        [
          {},
          { source: 'session_file' },
          provider === 'codex' ? 'agent.prompt_unsupported' : 'agent.state_unknown',
        ],
        [{}, { state: 'waiting', blockedReason: null }, 'agent.blocked'],
        [{}, { state: 'exited' }, 'agent.not_running'],
        [{}, { state: 'unknown', turn: null }, 'agent.state_unknown'],
        [{}, { turn: null }, 'agent.state_unknown'],
      ]
      for (const [context, snapshot, code] of cases) {
        expect(
          promptAdmission(
            { ...base, ...context, snapshot: { ...base.snapshot, ...snapshot } },
            capability,
            'steer',
          ),
        ).toMatchObject({ code })
      }
    } finally {
      f.dispose()
    }
  },
)
