import { request } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createClaudeHookChannel } from '../../../src/app/main/controlSurface/agentHook/claudeHookChannel'
import { createCodexHookChannel } from '../../../src/app/main/controlSurface/agentHook/codexHookChannel'
import { TerminalAgentInvocationRegistry } from '../../../src/contexts/agent/application/TerminalAgentInvocationRegistry'
import type {
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '../../../src/shared/contracts/dto'
import type { AgentHookChannel } from '../../../src/shared/runtime/agentHook/agentHookChannel'

const channels: AgentHookChannel[] = []
afterEach(async () => {
  await Promise.all(channels.splice(0).map(channel => channel.dispose()))
})

function postJson(endpoint: string, token: string, payload: unknown): Promise<number> {
  const body = JSON.stringify(payload)
  return new Promise((resolveResponse, reject) => {
    const outgoing = request(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-opencove-hook-token': token,
      },
    })
    outgoing.once('error', reject)
    outgoing.once('response', response => {
      response.resume()
      response.once('end', () => resolveResponse(response.statusCode ?? 0))
    })
    outgoing.end(body)
  })
}

async function createChannel(channel = createClaudeHookChannel({})) {
  channels.push(channel)
  await channel.start()
  expect(channel.getInstallState()).toBe('installed')
  const metadata: TerminalSessionMetadataEvent[] = []
  const states: TerminalSessionStateEvent[] = []
  channel.onMetadata(event => metadata.push(event))
  channel.onState(event => states.push(event))
  return { channel, metadata, states }
}

function claudeEvent(sessionId: string, eventName = 'SessionStart') {
  return {
    session_id: sessionId,
    transcript_path: `/fixture/project/${sessionId}.jsonl`,
    cwd: '/fixture/project',
    hook_event_name: eventName,
  }
}

describe('managed Claude SessionStart identity', () => {
  it.each(['before', 'after'] as const)(
    'binds the authenticated provider identity when SessionStart arrives %s PTY commit',
    async timing => {
      const { channel, metadata, states } = await createChannel()
      const reservation = await channel.reserveSpawn()
      const sendStart = (id: string) =>
        postJson(
          channel.getEndpoint()!,
          reservation.env!.OPENCOVE_CLAUDE_HOOK_TOKEN!,
          claudeEvent(id),
        )
      if (timing === 'after') {
        reservation.commit('managed-pty')
      }
      expect(await sendStart('owned-claude-session')).toBe(204)
      if (timing === 'before') {
        expect(metadata).toEqual([])
        reservation.commit('managed-pty')
      }

      expect(metadata).toEqual([
        { sessionId: 'managed-pty', resumeSessionId: 'owned-claude-session' },
      ])
      expect(states).toEqual([])
      expect(await sendStart('owned-claude-session')).toBe(204)
      expect(await sendStart('conflicting-session')).toBe(204)
      expect(metadata).toHaveLength(1)
      expect(states).toEqual([])
    },
  )

  it('keeps two same-directory managed launches bound to their own authenticated identities', async () => {
    const { channel, metadata } = await createChannel()
    const first = await channel.reserveSpawn()
    const second = await channel.reserveSpawn()
    first.commit('managed-pty-a')
    second.commit('managed-pty-b')

    expect(
      await postJson(
        channel.getEndpoint()!,
        second.env!.OPENCOVE_CLAUDE_HOOK_TOKEN!,
        claudeEvent('claude-b'),
      ),
    ).toBe(204)
    expect(
      await postJson(
        channel.getEndpoint()!,
        first.env!.OPENCOVE_CLAUDE_HOOK_TOKEN!,
        claudeEvent('claude-a'),
      ),
    ).toBe(204)
    expect(metadata).toEqual([
      { sessionId: 'managed-pty-b', resumeSessionId: 'claude-b' },
      { sessionId: 'managed-pty-a', resumeSessionId: 'claude-a' },
    ])
  })

  it('rejects unauthenticated or disposed launches and does not infer identity from turn events', async () => {
    const { channel, metadata } = await createChannel()
    const reservation = await channel.reserveSpawn()
    const token = reservation.env!.OPENCOVE_CLAUDE_HOOK_TOKEN!
    const endpoint = channel.getEndpoint()!
    reservation.commit('managed-pty')

    expect(await postJson(endpoint, 'forged', claudeEvent('other-session'))).toBe(401)
    expect(await postJson(endpoint, token, claudeEvent('other-session', 'UserPromptSubmit'))).toBe(
      204,
    )
    expect(metadata).toEqual([])
    channel.disposeSession('managed-pty')
    expect(await postJson(endpoint, token, claudeEvent('other-session'))).toBe(401)
    expect(metadata).toEqual([])
  })

  it('keeps terminal identity owned by the real invocation registry', async () => {
    const { channel, metadata } = await createChannel()
    const registry = new TerminalAgentInvocationRegistry()
    const terminal = registry.reserve({ sourceId: 'terminal-source' })
    try {
      const invocation = terminal.beginInvocation({
        invocationId: 'terminal-invocation',
        provider: 'claude-code',
      })!
      terminal.bind('terminal-pty')
      const reservation = await channel.reserveSpawn()
      reservation.commit('terminal-pty', {
        provider: 'claude-code',
        invocationId: 'terminal-invocation',
        generation: invocation.generation,
        isCurrent: invocation.isCurrent,
        observe: invocation.observe,
      })
      expect(
        await postJson(
          channel.getEndpoint()!,
          reservation.env!.OPENCOVE_CLAUDE_HOOK_TOKEN!,
          claudeEvent('terminal-claude-session'),
        ),
      ).toBe(204)
      expect(metadata).toEqual([])
      expect(registry.list().entries).toEqual([
        expect.objectContaining({
          sessionId: 'terminal-pty',
          resumeSessionId: 'terminal-claude-session',
          terminalAgentActivity: expect.objectContaining({
            identityAuthority: 'provider_session_start',
            phase: 'active',
          }),
        }),
      ])
    } finally {
      terminal.release()
    }
  })

  it.each(['stale', 'rejected'] as const)(
    'does not downgrade a %s terminal invocation to a managed identity',
    async reason => {
      const { channel, metadata } = await createChannel()
      const reservation = await channel.reserveSpawn()
      reservation.commit('terminal-pty', {
        provider: 'claude-code',
        invocationId: 'terminal-invocation',
        generation: 1,
        isCurrent: () => reason !== 'stale',
        observe: () => false,
      })
      expect(
        await postJson(
          channel.getEndpoint()!,
          reservation.env!.OPENCOVE_CLAUDE_HOOK_TOKEN!,
          claudeEvent('unowned-session'),
        ),
      ).toBe(204)
      expect(metadata).toEqual([])
    },
  )

  it('leaves managed Codex identity discovery unchanged', async () => {
    const { channel, metadata } = await createChannel(createCodexHookChannel({}))
    const reservation = await channel.reserveSpawn()
    reservation.commit('codex-pty')
    expect(
      await postJson(channel.getEndpoint()!, reservation.env!.OPENCOVE_CODEX_HOOK_TOKEN!, {
        version: 1,
        state: 'working',
        hookEventName: 'SessionStart',
        codexSessionId: 'codex-session',
      }),
    ).toBe(204)
    expect(metadata).toEqual([])
  })
})
