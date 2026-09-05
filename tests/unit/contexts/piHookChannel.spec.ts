// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createPiHookChannel } from '../../../src/app/main/controlSurface/agentHook/piHookChannel'
import { TerminalAgentInvocationRegistry } from '../../../src/contexts/agent/application/TerminalAgentInvocationRegistry'
import type {
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '../../../src/shared/contracts/dto'

const channels: ReturnType<typeof createPiHookChannel>[] = []
afterEach(async () => {
  await Promise.all(channels.splice(0).map(channel => channel.dispose()))
})

async function setup() {
  const channel = createPiHookChannel()
  channels.push(channel)
  const reservation = await channel.reserveSpawn()
  const states: TerminalSessionStateEvent[] = []
  const metadata: TerminalSessionMetadataEvent[] = []
  const fallbackStates: TerminalSessionStateEvent[] = []
  channel.onState(event => (event.source === 'pi_hook' ? states : fallbackStates).push(event))
  channel.onMetadata(event => metadata.push(event))
  const send = async (
    sequence: number,
    overrides: Record<string, unknown> = {},
    token?: string,
  ) => {
    const response = await fetch(reservation.env!.OPENCOVE_PI_HOOK_ENDPOINT!, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-opencove-hook-token': token ?? reservation.env!.OPENCOVE_PI_HOOK_TOKEN!,
      },
      body: JSON.stringify({
        version: 1,
        pid: 123,
        sequence,
        conversationRevision: 1,
        sessionId: 'a',
        sessionFile: '/sessions/a.jsonl',
        persistence: 'resumable',
        state: 'working',
        ...overrides,
      }),
    })
    await response.arrayBuffer()
    return response.status
  }
  return { channel, reservation, states, fallbackStates, metadata, send }
}

describe('Pi hook channel', () => {
  it('authenticates and validates before any state escapes', async () => {
    const { reservation, send, states, fallbackStates, metadata } = await setup()
    reservation.commit('pty')
    expect(await send(1, {}, 'wrong')).toBe(401)
    expect(await send(0)).toBe(400)
    expect(states).toEqual([])
    expect(metadata).toEqual([])
    expect(await send(1)).toBe(204)
    expect(states).toEqual([
      {
        sessionId: 'pty',
        state: 'working',
        source: 'pi_hook',
        hookInstallState: 'installed',
        piConversation: { pid: 123, revision: 1 },
      },
    ])
    expect(fallbackStates).toEqual([
      expect.objectContaining({ source: 'session_file', observationUnavailable: true }),
    ])
    expect(metadata[0]).toMatchObject({ resumeSessionId: '/sessions/a.jsonl', agentProvider: 'pi' })
  })

  it('retains complete latest identity through pre-commit coalescing, rejecting older arrivals', async () => {
    const { reservation, send, states } = await setup()
    await send(1)
    await send(3, { state: 'waiting' })
    await send(2, { state: 'standby' })
    const registry = new TerminalAgentInvocationRegistry()
    const terminal = registry.reserve({ sourceId: 'shim' })
    terminal.bind('pty')
    const invocation = terminal.beginInvocation({ provider: 'pi', invocationId: 'launch' })!
    reservation.commit('pty', {
      provider: 'pi',
      invocationId: 'launch',
      generation: 1,
      isCurrent: invocation.isCurrent,
      observe: invocation.observe,
    })
    expect(states).toHaveLength(1)
    expect(states[0].state).toBe('waiting')
    expect(registry.list().entries[0].resumeSessionId).toBe('/sessions/a.jsonl')
  })

  it('isolates credentials, process ids, stale events and disposed sessions', async () => {
    const { reservation, channel, send, states } = await setup()
    reservation.commit('pty')
    await send(2)
    await send(1, { state: 'standby' })
    await send(100, { pid: 456 })
    expect(states).toHaveLength(1)
    await send(3, { state: 'waiting' })
    expect(states).toHaveLength(2)
    channel.disposeSession('pty')
    expect(await send(4)).toBe(401)
    expect(states).toHaveLength(2)
  })
})
