import { WebSessionManager } from '../../../src/app/main/controlSurface/http/webSessionManager'
// @vitest-environment node
import { createServer, type ServerResponse } from 'node:http'
import { expect, it } from 'vitest'
import {
  createControlSurfaceHttpRequestHandler,
  type ControlSurfaceHttpRequestHandlerDeps,
} from '../../../src/app/main/controlSurface/controlSurfaceHttpRequestHandler'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerAgentRunStateHandlers } from '../../../src/app/main/controlSurface/handlers/agentRunStateHandlers'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import type { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'

it('queries and resumes filtered agent events over authenticated HTTP, resyncing on epoch and retention gaps', async () => {
  const registry = new AgentRunStateRegistry({
    epoch: 'epoch',
    now: () => 100,
    createTurnId: () => 'turn',
    schedule: () => () => {},
    retention: 3,
  })
  registry.register({
    sessionId: 's',
    nodeId: 'n',
    provider: 'codex',
    incarnation: 'i',
    spaceId: 'space',
  })
  const surface = createControlSurface()
  registerAgentRunStateHandlers(surface, { agentRuns: { registry } } as PtyStreamHub)
  const clients = new Set<ServerResponse>()
  const handler = createControlSurfaceHttpRequestHandler({
    controlSurface: surface,
    token: 'token',
    webSessions: new WebSessionManager(),
    ctx: { now: () => new Date(), capabilities: {} },
    agentRuns: registry,
    agentClients: clients,
    syncClients: new Set(),
    syncEventBuffer: [],
    isRuntimeClosed: () => false,
    getWebAccessPolicy: () => ({ enabled: false, passwordRequired: false }),
  } as unknown as ControlSurfaceHttpRequestHandlerDeps)
  const server = createServer((req, res) => {
    void handler({
      req,
      res,
      listenerSyncClients: clients,
      listener: {
        role: 'private',
        hostname: '127.0.0.1',
        bindHostname: '127.0.0.1',
        port: 0,
        enableWebShell: false,
        webUiPasswordHash: null,
        webUiAuthRevision: 0,
        isWebUiAuthRevisionCurrent: () => true,
      },
    })
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Missing address')
    }
    const base = `http://127.0.0.1:${address.port}`
    const headers = { authorization: 'Bearer token', 'content-type': 'application/json' }
    const gets = await Promise.all(
      [
        { nodeId: 'n' },
        { sessionId: 's' },
        { sessionId: 'absent' },
        { nodeId: 'n', sessionId: 's' },
      ].map(async payload => {
        const response = await fetch(`${base}/invoke`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ kind: 'query', id: 'agent.get', payload }),
        })
        return response.json()
      }),
    )
    expect(gets[0]).toMatchObject({
      ok: true,
      value: { sessionId: 's', state: 'unknown', quality: 'degraded' },
    })
    expect(gets[1]).toEqual(gets[0])
    expect(gets[2]).toMatchObject({ ok: true, value: null })
    expect(gets[3]).toMatchObject({ ok: false })
    const query = await fetch(`${base}/invoke`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ kind: 'query', id: 'agent.list', payload: { spaceId: 'space' } }),
    })
    const result = await query.json()
    expect(result).toMatchObject({
      ok: true,
      value: { epoch: 'epoch', seq: 1, agents: [{ sessionId: 's' }] },
    })
    registry.observe('s', {
      incarnation: 'i',
      source: 'codex_hook',
      sourceSequence: 1,
      observedAt: 100,
      state: 'working',
      boundary: { kind: 'start', evidence: 'prompt_submit' },
    })
    registry.observe('s', {
      incarnation: 'i',
      source: 'codex_hook',
      sourceSequence: 2,
      observedAt: 100,
      state: 'idle',
      boundary: { kind: 'end', outcome: 'completed' },
    })
    const response = await fetch(
      `${base}/events?types=agent.turn_completed&nodeId=n&spaceId=space&epoch=epoch&afterSeq=1`,
      { headers, signal: AbortSignal.timeout(2000) },
    )
    const reader = response.body!.getReader()
    let text = ''
    while (!text.includes('agent.turn_completed')) {
      // Stream reads consume one ordered cursor.
      // eslint-disable-next-line no-await-in-loop
      text += new TextDecoder().decode((await reader.read()).value)
    }
    expect(text).toContain('"turnOutcome":"completed"')
    expect(text).not.toContain('agent.state_changed')
    await reader.cancel()
    await Promise.all(
      ['epoch=old&afterSeq=4', 'epoch=epoch&afterSeq=0'].map(async cursor => {
        const gap = await fetch(`${base}/events?stream=agent&${cursor}`, {
          headers,
          signal: AbortSignal.timeout(2000),
        })
        expect(await gap.text()).toContain('"query":"agent.list"')
      }),
    )
    const beforeMove = registry.list()
    registry.bind('s', { nodeId: null, spaceId: 'other' })
    const moved = await fetch(
      `${base}/events?stream=agent&spaceId=space&nodeId=n&epoch=${beforeMove.epoch}&afterSeq=${beforeMove.seq}`,
      {
        headers,
        signal: AbortSignal.timeout(2000),
      },
    )
    expect(await moved.text()).toContain('"type":"resync_required"')
    const invalid = await fetch(`${base}/events?stream=agent&afterSeq=nope`, { headers })
    expect(invalid.status).toBe(400)
    const unauthorized = await fetch(`${base}/events?stream=agent`)
    expect(unauthorized.status).toBe(401)
  } finally {
    registry.dispose()
    clients.forEach(client => client.destroy())
    server.closeAllConnections()
    if (server.listening) {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  }
})
