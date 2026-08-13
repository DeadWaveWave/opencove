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

const providers = [
  {
    label: 'Claude',
    source: 'claude_hook',
    tokenKey: 'OPENCOVE_CLAUDE_HOOK_TOKEN',
    create: createClaudeHookChannel,
    envelope: {
      version: 1,
      state: 'waiting',
      hookEventName: 'PermissionRequest',
      claudeSessionId: 'provider-session',
    },
  },
  {
    label: 'Codex',
    source: 'codex_hook',
    tokenKey: 'OPENCOVE_CODEX_HOOK_TOKEN',
    create: createCodexHookChannel,
    envelope: {
      version: 1,
      state: 'waiting',
      hookEventName: 'PermissionRequest',
      codexSessionId: 'provider-session',
    },
  },
] as const

function post(endpoint: string, token: string, payload: unknown): Promise<number> {
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

describe.each(providers)('$label shared agent hook channel contract', provider => {
  it('authenticates, buffers until commit, flushes, and disposes one reservation', async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), 'opencove-agent-hook-channel-'))
    roots.push(homeDirectory)
    const channel = provider.create({
      homeDirectory,
      helperCommand: 'node',
      install: vi.fn(async () => ({ state: 'installed' as const, detail: null })),
    })
    await channel.start()
    const endpoint = channel.getEndpoint()!
    const reservation = await channel.reserveSpawn()
    const token = reservation.env?.[provider.tokenKey] ?? ''
    const events: unknown[] = []
    channel.onState(event => events.push(event))

    await expect(post(endpoint, 'forged', provider.envelope)).resolves.toBe(401)
    await expect(post(endpoint, token, provider.envelope)).resolves.toBe(204)
    expect(events).toEqual([])
    reservation.commit('pty-session')
    expect(events).toEqual([
      {
        sessionId: 'pty-session',
        state: 'waiting',
        source: provider.source,
        hookInstallState: 'installed',
      },
    ])

    channel.disposeSession('pty-session')
    await expect(post(endpoint, token, provider.envelope)).resolves.toBe(401)
    await channel.dispose()
  })
})

describe('provider-isolated agent hook channels', () => {
  it('does not accept another provider reservation token', async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), 'opencove-agent-hook-isolation-'))
    roots.push(homeDirectory)
    const install = vi.fn(async () => ({ state: 'installed' as const, detail: null }))
    const claude = createClaudeHookChannel({ homeDirectory, helperCommand: 'node', install })
    const codex = createCodexHookChannel({ homeDirectory, helperCommand: 'node', install })
    await Promise.all([claude.start(), codex.start()])
    const claudeReservation = await claude.reserveSpawn()
    const codexReservation = await codex.reserveSpawn()
    const claudeToken = claudeReservation.env?.OPENCOVE_CLAUDE_HOOK_TOKEN ?? ''
    const codexToken = codexReservation.env?.OPENCOVE_CODEX_HOOK_TOKEN ?? ''

    await expect(post(claude.getEndpoint()!, codexToken, providers[0].envelope)).resolves.toBe(401)
    await expect(post(codex.getEndpoint()!, claudeToken, providers[1].envelope)).resolves.toBe(401)

    claudeReservation.dispose()
    codexReservation.dispose()
    await Promise.all([claude.dispose(), codex.dispose()])
  })
})
