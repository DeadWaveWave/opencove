import { mkdtemp, rm } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClaudeHookChannel } from '../../../src/app/main/controlSurface/agentHook/claudeHookChannel'
import { createCodexHookChannel } from '../../../src/app/main/controlSurface/agentHook/codexHookChannel'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
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

describe('shared agent hook channel contract', () => {
  it('delivers real Claude lifecycle identity without fabricating or resetting a turn', async () => {
    const channel = createClaudeHookChannel({})
    const reservation = await channel.reserveSpawn()
    const states: unknown[] = []
    const metadata: unknown[] = []
    channel.onState(event => states.push(event))
    channel.onMetadata(event => metadata.push(event))
    const send = (hook_event_name: string, source?: string) =>
      postJson(channel.getEndpoint()!, reservation.env!.OPENCOVE_CLAUDE_HOOK_TOKEN!, {
        session_id: 'real-session',
        transcript_path: '/tmp/real-session.jsonl',
        cwd: '/tmp',
        hook_event_name,
        source,
      })
    try {
      // SessionStart may arrive while the launcher is still committing the reservation.
      expect(await send('SessionStart', 'startup')).toBe(204)
      reservation.commit('pty-real', {
        provider: 'claude-code',
        invocationId: 'inv-1',
        generation: 1,
        isCurrent: () => true,
      })
      expect(states).toEqual([])
      expect(metadata).toHaveLength(1)
      expect(await send('UserPromptSubmit')).toBe(204)
      expect(states).toEqual([expect.objectContaining({ state: 'working', source: 'claude_hook' })])
      expect(await send('SessionStart', 'compact')).toBe(204)
      expect(await send('SessionStart', 'startup')).toBe(204)
      expect(states).toHaveLength(1)
      expect(await send('Stop')).toBe(204)
      expect(states).toHaveLength(2)
      expect(states[1]).toMatchObject({ state: 'standby' })
      expect(await send('SessionStart', 'resume')).toBe(204)
      expect(states).toHaveLength(2)
      expect(metadata).toHaveLength(1)
      expect(await send('SessionEnd')).toBe(204)
      expect(states[2]).toMatchObject({ state: 'standby' })
      // /clear and /resume can end a conversation without ending the invocation.
      expect(metadata).toHaveLength(1)
      expect(metadata[0]).toMatchObject({ terminalAgentActivity: { phase: 'active' } })
      expect(await send('UserPromptSubmit')).toBe(204)
      expect(states[3]).toMatchObject({ state: 'working' })
    } finally {
      await channel.dispose()
    }
  })

  it('binds terminal identity only from a current authenticated SessionStart', async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), 'opencove-agent-hook-identity-'))
    roots.push(homeDirectory)
    const channel = createClaudeHookChannel({
      homeDirectory,
      helperCommand: 'node',
      install: vi.fn(async () => ({ state: 'installed' as const, detail: null })),
    })
    await channel.start()
    const reservation = await channel.reserveSpawn()
    const token = reservation.env?.OPENCOVE_CLAUDE_HOOK_TOKEN ?? ''
    let current = true
    const metadata: unknown[] = []
    const states: unknown[] = []
    channel.onMetadata(event => metadata.push(event))
    channel.onState(event => states.push(event))
    reservation.commit('pty-session', {
      provider: 'claude-code',
      invocationId: 'invocation-1',
      generation: 1,
      isCurrent: () => current,
    })

    await expect(
      postJson(channel.getEndpoint()!, token, {
        version: 1,
        state: 'working',
        hookEventName: 'SessionStart',
        claudeSessionId: 'claude-session-1',
      }),
    ).resolves.toBe(204)
    expect(metadata).toEqual([
      {
        sessionId: 'pty-session',
        resumeSessionId: 'claude-session-1',
        terminalAgentActivity: {
          provider: 'claude-code',
          invocationId: 'invocation-1',
          generation: 1,
          phase: 'active',
          observedAtMs: expect.any(Number),
          identityAuthority: 'provider_session_start',
        },
      },
    ])
    expect(states).toHaveLength(0)

    await expect(
      postJson(channel.getEndpoint()!, token, {
        version: 1,
        state: 'working',
        hookEventName: 'SessionStart',
        claudeSessionId: 'claude-session-1',
      }),
    ).resolves.toBe(204)
    await expect(
      postJson(channel.getEndpoint()!, token, {
        version: 1,
        state: 'working',
        hookEventName: 'SessionStart',
        claudeSessionId: 'forged-replacement',
      }),
    ).resolves.toBe(204)
    expect(metadata).toHaveLength(1)
    expect(states).toHaveLength(0)

    const nextReservation = await channel.reserveSpawn()
    const nextToken = nextReservation.env?.OPENCOVE_CLAUDE_HOOK_TOKEN ?? ''
    nextReservation.commit('pty-session', {
      provider: 'claude-code',
      invocationId: 'invocation-2',
      generation: 2,
      isCurrent: () => true,
    })
    await expect(
      postJson(channel.getEndpoint()!, nextToken, {
        version: 1,
        state: 'working',
        hookEventName: 'SessionStart',
        claudeSessionId: 'claude-session-2',
      }),
    ).resolves.toBe(204)
    expect(metadata).toHaveLength(2)
    expect(metadata[1]).toMatchObject({
      resumeSessionId: 'claude-session-2',
      terminalAgentActivity: { invocationId: 'invocation-2', generation: 2 },
    })

    const registryObservation = vi.fn(() => true)
    const registryReservation = await channel.reserveSpawn()
    const registryToken = registryReservation.env?.OPENCOVE_CLAUDE_HOOK_TOKEN ?? ''
    registryReservation.commit('pty-registry-owned', {
      provider: 'claude-code',
      invocationId: 'invocation-3',
      generation: 3,
      isCurrent: () => true,
      observe: registryObservation,
    })
    await expect(
      postJson(channel.getEndpoint()!, registryToken, {
        version: 1,
        state: 'working',
        hookEventName: 'SessionStart',
        claudeSessionId: 'registry-session-3',
      }),
    ).resolves.toBe(204)
    expect(registryObservation).toHaveBeenCalledWith({
      identityAuthority: 'provider_session_start',
      resumeSessionId: 'registry-session-3',
    })
    expect(metadata).toHaveLength(2)

    current = false
    await expect(
      postJson(channel.getEndpoint()!, token, {
        version: 1,
        state: 'waiting',
        hookEventName: 'PermissionRequest',
        claudeSessionId: 'claude-session-1',
      }),
    ).resolves.toBe(204)
    expect(states).toHaveLength(0)
    await channel.dispose()
  })

  it('keeps the existing provider channel isolated by reservation token', async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), 'opencove-agent-hook-channel-'))
    roots.push(homeDirectory)
    const channel = createClaudeHookChannel({
      homeDirectory,
      helperCommand: 'node',
      install: vi.fn(async () => ({ state: 'installed' as const, detail: null })),
    })
    await channel.start()
    const reservation = await channel.reserveSpawn()
    const token = reservation.env?.OPENCOVE_CLAUDE_HOOK_TOKEN ?? ''
    const envelope = {
      version: 1,
      state: 'waiting',
      hookEventName: 'PermissionRequest',
      claudeSessionId: 'provider-session',
    }
    const events: unknown[] = []
    channel.onState(event => events.push(event))

    await expect(postJson(channel.getEndpoint()!, 'forged', envelope)).resolves.toBe(401)
    await expect(postJson(channel.getEndpoint()!, token, envelope)).resolves.toBe(204)
    expect(events).toEqual([])
    reservation.commit('pty-session')
    expect(events).toEqual([
      {
        sessionId: 'pty-session',
        state: 'waiting',
        source: 'claude_hook',
        hookInstallState: 'installed',
      },
    ])
    channel.disposeSession('pty-session')
    await expect(postJson(channel.getEndpoint()!, token, envelope)).resolves.toBe(401)
    await channel.dispose()
  })
})

describe('Codex hook channel', () => {
  it('uses one ephemeral credential per launch and clears it with the PTY session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-codex-hook-channel-'))
    roots.push(root)
    const channel = createCodexHookChannel({})
    await channel.start()
    const reservation = await channel.reserveSpawn()
    const token = reservation.env?.OPENCOVE_CODEX_HOOK_TOKEN ?? ''
    const envelope = {
      version: 1,
      state: 'waiting',
      hookEventName: 'PermissionRequest',
      codexSessionId: 'provider-session',
    }
    const events: unknown[] = []
    channel.onState(event => events.push(event))

    await expect(postJson(channel.getEndpoint()!, 'forged', envelope)).resolves.toBe(401)
    await expect(postJson(channel.getEndpoint()!, token, envelope)).resolves.toBe(204)
    expect(events).toEqual([])
    reservation.commit('pty-session')
    expect(events).toEqual([
      {
        sessionId: 'pty-session',
        state: 'waiting',
        source: 'codex_hook',
        hookInstallState: 'installed',
      },
    ])
    channel.disposeSession('pty-session')
    await expect(postJson(channel.getEndpoint()!, token, envelope)).resolves.toBe(401)
    expect(events).toHaveLength(1)
    await channel.dispose()
  })
})
