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
    expect(states).toHaveLength(1)

    current = false
    await expect(
      postJson(channel.getEndpoint()!, token, {
        version: 1,
        state: 'waiting',
        hookEventName: 'PermissionRequest',
        claudeSessionId: 'claude-session-1',
      }),
    ).resolves.toBe(204)
    expect(states).toHaveLength(1)
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
