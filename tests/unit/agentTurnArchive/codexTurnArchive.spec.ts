// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { InMemoryAgentTurnArchive } from '../../support/agentTurnArchive/InMemoryAgentTurnArchive'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, node } from '../app/cliIdentity.helpers'

it.each(['claude-code', 'codex'] as const)(
  'archives %s replies with the same CLI exact-read shape across restart and hook modes',
  async provider => {
    const archive = new InMemoryAgentTurnArchive({ now: () => 100 })
    const registry = () =>
      new AgentRunStateRegistry({
        archive,
        membership: () => 'member',
        epoch: 'e',
        now: () => 100,
        createTurnId: () => 'turn',
        schedule: () => () => {},
      })
    const old = registry()
    old.register({ sessionId: 's', incarnation: 'i', provider, nodeId: node.id })
    const identity = {
      providerSessionId: 'provider',
      ...(provider === 'codex' ? { providerTurnId: 'A' } : { promptId: 'A' }),
    }
    const observe = (end: boolean, seq: number, message?: string) =>
      old.observe(
        's',
        {
          source: provider === 'codex' ? 'codex_hook' : 'claude_hook',
          incarnation: 'i',
          sourceSequence: seq,
          observedAt: seq,
          emittedAtMs: seq,
          hookEventName: end ? 'Stop' : 'UserPromptSubmit',
          state: end ? 'idle' : 'working',
          boundary: end
            ? { kind: 'end', outcome: 'completed' }
            : { kind: 'start', evidence: 'prompt_submit' },
        },
        { ...identity, ...(message ? { finalMessage: { message, truncated: true } } : {}) },
      )
    const append = vi.spyOn(archive, 'append')
    observe(false, 1)
    observe(true, 2, 'reply 🙂')
    observe(true, 3, 'replacement')
    expect(append).toHaveBeenCalledOnce()
    expect(append.mock.calls[0][0]).not.toHaveProperty('providerTurnId')
    old.dispose()
    await Promise.all(
      (['lifecycle', 'none', 'notify_only'] as const).map(async hookCoverage => {
        const fresh = registry()
        fresh.register({ sessionId: 'replacement', incarnation: 'new', provider, nodeId: node.id })
        fresh.setRuntimeContext('replacement', {
          remote: false,
          hookCoverage,
          hookInstallState: hookCoverage === 'none' ? 'skipped' : 'installed',
        })
        const f = identityFixture()
        const original = f.io.fetch
        f.io.fetch = async (url, init) =>
          JSON.parse(String(init?.body)).id === 'agent.finalMessage'
            ? new Response(
                JSON.stringify({
                  ok: true,
                  value: fresh.finalMessage({ nodeId: node.id, turnId: 'turn' }),
                }),
              )
            : original(url, init)
        expect(
          await run(['agent', 'read', '--node', node.id, '--turn', 'turn', '-o', 'json'], f.io),
        ).toBe(0)
        expect(JSON.parse(f.out())).toEqual({
          nodeId: node.id,
          sessionId: 's',
          turnId: 'turn',
          outcome: 'completed',
          message: 'reply 🙂',
          truncated: true,
          source: 'hook',
          persisted: true,
          promptIds: provider === 'codex' ? [] : ['A'],
          endedAt: 2,
          ...(provider === 'codex' ? {} : { promptId: 'A' }),
        })
        fresh.dispose()
      }),
    )
  },
)
