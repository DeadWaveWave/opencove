import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClaudeHookChannel } from '../../../src/app/main/controlSurface/agentHook/claudeHookChannel'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function createChannel(port = 0) {
  const homeDirectory = await mkdtemp(join(tmpdir(), 'opencove-hook-channel-'))
  roots.push(homeDirectory)
  const channel = createClaudeHookChannel({
    homeDirectory,
    helperCommand: 'node',
    helperArgs: ['/tmp/helper.mjs'],
    port,
    install: vi.fn(async () => ({ state: 'installed' as const, detail: null })),
  })
  await channel.start()
  return channel
}

async function post(
  endpoint: string,
  token: string | null,
  state = 'waiting',
  options: { payload?: unknown; contentType?: string } = {},
): Promise<{ status: number }> {
  const body = JSON.stringify(
    options.payload ?? {
      version: 1,
      state,
      hookEventName: state === 'waiting' ? 'PermissionRequest' : 'UserPromptSubmit',
      claudeSessionId: 'claude-session',
      tool: { name: 'Bash', useId: 'tool-1', input: { command: 'true' } },
    },
  )
  return await new Promise((resolveResponse, reject) => {
    const outgoing = request(endpoint, {
      method: 'POST',
      headers: {
        'content-type': options.contentType ?? 'application/json',
        'content-length': Buffer.byteLength(body),
        ...(token ? { 'x-opencove-hook-token': token } : {}),
      },
    })
    outgoing.once('error', reject)
    outgoing.once('response', response => {
      response.resume()
      response.once('end', () => resolveResponse({ status: response.statusCode ?? 0 }))
    })
    outgoing.end(body)
  })
}

describe('Claude hook channel', () => {
  it('rejects missing and forged credentials and binds valid events to one session', async () => {
    const channel = await createChannel()
    const endpoint = channel.getEndpoint()
    if (!endpoint) {
      throw new Error('Missing receiver endpoint.')
    }
    const reservation = await channel.reserveSpawn()
    const token = reservation.env?.OPENCOVE_CLAUDE_HOOK_TOKEN
    if (!token) {
      throw new Error('Missing correlation token.')
    }
    const events: unknown[] = []
    channel.onState(event => events.push(event))
    reservation.commit('session-1')

    await expect(post(endpoint, null)).resolves.toMatchObject({ status: 401 })
    await expect(post(endpoint, 'forged')).resolves.toMatchObject({ status: 401 })
    await expect(post(endpoint, token)).resolves.toMatchObject({ status: 204 })
    expect(events).toEqual([
      {
        sessionId: 'session-1',
        state: 'waiting',
        source: 'claude_hook',
        hookInstallState: 'installed',
      },
    ])

    channel.disposeSession('session-1')
    await expect(post(endpoint, token)).resolves.toMatchObject({ status: 401 })
    await channel.dispose()
  })

  it('buffers authenticated events until the PTY session id is committed', async () => {
    const channel = await createChannel()
    const endpoint = channel.getEndpoint()!
    const reservation = await channel.reserveSpawn()
    const token = reservation.env?.OPENCOVE_CLAUDE_HOOK_TOKEN ?? ''
    const events: unknown[] = []
    channel.onState(event => events.push(event))

    await expect(post(endpoint, token, 'working')).resolves.toMatchObject({ status: 204 })
    expect(events).toEqual([])
    reservation.commit('session-1')
    expect(events).toEqual([
      {
        sessionId: 'session-1',
        state: 'working',
        source: 'claude_hook',
        hookInstallState: 'installed',
      },
    ])
    await channel.dispose()
  })

  it('rejects malformed and non-JSON inbound payloads after authentication', async () => {
    const channel = await createChannel()
    const endpoint = channel.getEndpoint()!
    const reservation = await channel.reserveSpawn()
    const token = reservation.env?.OPENCOVE_CLAUDE_HOOK_TOKEN ?? ''

    await expect(
      post(endpoint, token, 'working', { payload: { version: 1, state: 'working' } }),
    ).resolves.toMatchObject({ status: 400 })
    await expect(
      post(endpoint, token, 'working', { contentType: 'text/plain' }),
    ).resolves.toMatchObject({ status: 415 })
    await channel.dispose()
  })

  it('fails open when the dedicated receiver cannot bind', async () => {
    const channel = await createChannel(-1)
    expect(channel.getInstallState()).toBe('error')
    await expect(channel.reserveSpawn()).resolves.toMatchObject({
      env: null,
      installState: 'error',
      usesHook: false,
    })
    await channel.dispose()
  })
})
