import { mkdtemp, readFile, rm } from 'node:fs/promises'
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

function postCodex(endpoint: string, token: string, paneKey: string): Promise<number> {
  const body = new URLSearchParams({
    paneKey,
    tabId: 'tab-1',
    worktreeId: 'worktree-1',
    env: 'test',
    version: '1',
    payload: JSON.stringify({
      session_id: 'provider-session',
      transcript_path: '/tmp/session.jsonl',
      cwd: '/tmp/project',
      hook_event_name: 'PermissionRequest',
      model: 'gpt-5',
    }),
  }).toString()
  return new Promise((resolveResponse, reject) => {
    const outgoing = request(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': Buffer.byteLength(body),
        'x-opencove-agent-hook-token': token,
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

describe('pane-correlated hook channel', () => {
  it('sources one server token, buffers by pane key, and clears with the PTY session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-codex-hook-channel-'))
    roots.push(root)
    const channel = createCodexHookChannel({
      homeDirectory: root,
      userDataDirectory: root,
      runtimeHomeDirectory: join(root, 'runtime-home'),
      scriptPath: join(root, 'codex-hook.sh'),
      install: vi.fn(async () => ({ state: 'installed' as const, detail: null })),
    })
    await channel.start()
    const endpointText = await readFile(join(root, 'agent-hooks', 'endpoint.env'), 'utf8')
    const token = /^OPENCOVE_AGENT_HOOK_TOKEN=(.+)$/mu.exec(endpointText)?.[1] ?? ''
    const reservation = await channel.reserveSpawn({
      paneKey: 'pane-1',
      tabId: 'tab-1',
      worktreeId: 'worktree-1',
    })
    const events: unknown[] = []
    channel.onState(event => events.push(event))

    await expect(postCodex(channel.getEndpoint()!, 'forged', 'pane-1')).resolves.toBe(403)
    await expect(postCodex(channel.getEndpoint()!, token, 'pane-1')).resolves.toBe(204)
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
    await expect(postCodex(channel.getEndpoint()!, token, 'pane-1')).resolves.toBe(204)
    expect(events).toHaveLength(1)
    await channel.dispose()
  })
})
