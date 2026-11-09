// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { AgentRunStateRuntime } from '../../../src/contexts/agent/application/AgentRunStateRuntime'
import { CliError } from '../../../src/app/cli/core/errors'
import { registryWaitFixture } from './agentWaitRegistry.helpers'

it.each(['remote_history_unavailable', 'archive_unavailable'] as const)(
  'reconciles the exact-turn history fence before exit attention (%s)',
  async reason => {
    const f = registryWaitFixture(true)
    const runtime = new AgentRunStateRuntime(f.registry, () => 100)
    runtime.metadata({ sessionId: 's', agentProvider: 'claude-code', resumeSessionId: null })
    runtime.setBindings([{ sessionId: 's', nodeId: 'n', projectId: 'p', remote: false }])
    runtime.observe({
      sessionId: 's',
      source: 'claude_hook',
      hookEventName: 'UserPromptSubmit',
      state: 'working',
      observedAtMs: 100,
    })
    const turnId = f.registry.get({ nodeId: 'n' })!.turn!.id
    const original = f.query.getMockImplementation()!
    f.query.mockImplementation(async (id, payload) => {
      if (id === 'agent.finalMessage') {
        throw new CliError('agent.final_message_unavailable', 1, 'Unavailable', undefined, {
          reason,
        })
      }
      const value = await original(id, payload)
      return id === 'agent.list' && reason === 'archive_unavailable'
        ? { ...(value as Record<string, unknown>), turnArchive: true }
        : value
    })
    const pending = f.wait(turnId)
    const assertion =
      reason === 'remote_history_unavailable'
        ? expect(pending).resolves.toMatchObject({ turnId, outcome: 'unknown', state: 'exited' })
        : expect(pending).rejects.toMatchObject({
            code: 'agent.wait_turn_unavailable',
            exitCode: 1,
            details: { reason: 'archive_unavailable', turnId },
          })
    try {
      await vi.waitFor(() =>
        expect(f.query.mock.calls.filter(([id]) => id === 'agent.list')).toHaveLength(3),
      )
      await new Promise(resolve => setImmediate(resolve))
      // A real exit queues state_changed first, then turn_completed. Legacy wire strips lastEndedTurn.
      runtime.exit('s')
      await assertion
      expect(f.events.slice(-2).map(event => event.type)).toEqual([
        'agent.state_changed',
        'agent.turn_completed',
      ])
      expect(f.subscriptions()).toEqual({ opened: 1, closed: 1 })
    } finally {
      runtime.dispose()
    }
  },
)
