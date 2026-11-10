import { expect, it } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerAgentRunStateHandlers } from '../../../src/app/main/controlSurface/handlers/agentRunStateHandlers'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'

it.each(['claude-code', 'codex'] as const)(
  'returns the shared exact-turn contract through agent.finalMessage for %s',
  async provider => {
    const f = promptDeliveryRuntimeFixture(undefined, provider)
    const surface = createControlSurface()
    registerAgentRunStateHandlers(surface, f.hub)
    const identity = {
      providerSessionId: 'provider',
      ...(provider === 'codex' ? { providerTurnId: 'A' } : { promptId: 'A' }),
    }
    try {
      f.observe('UserPromptSubmit', Date.now(), identity)
      f.observe('Stop', Date.now(), {
        ...identity,
        finalMessage: { message: 'Reply 🙂', truncated: true },
      })
      const result = await surface.invoke(
        { now: () => new Date(), capabilities: {} } as ControlSurfaceContext,
        {
          kind: 'query',
          id: 'agent.finalMessage',
          payload: { nodeId: 'n', turnId: 'turn' },
        },
      )
      expect(result).toMatchObject({
        ok: true,
        value: {
          nodeId: 'n',
          sessionId: 's',
          turnId: 'turn',
          outcome: 'completed',
          message: 'Reply 🙂',
          truncated: true,
          source: 'hook',
          promptIds: provider === 'codex' ? [] : ['A'],
          deliveryIds: [],
          persisted: false,
          memoryOnlyReason: 'unavailable',
        },
      })
      expect(result.ok && result.value).not.toHaveProperty('providerTurnId')
      if (provider === 'codex') {
        expect(result.ok && result.value).not.toHaveProperty('promptId')
      }
    } finally {
      f.dispose()
    }
  },
)
