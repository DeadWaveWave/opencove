// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import WebSocket from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { createControlSurfaceHttpRuntime } from '../../../src/app/main/controlSurface/controlSurfaceHttpRuntime'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import { createInMemoryPersistenceStore } from './controlSurfaceHttpServer.sessionStreaming.testUtils'

function createNoopPtyRuntime() {
  return {
    spawnSession: async () => ({ sessionId: 'test-session' }),
    write: () => undefined,
    resize: () => undefined,
    kill: () => undefined,
    onData: () => () => undefined,
    onExit: () => () => undefined,
  }
}

async function openClient(port: number): Promise<{
  socket: WebSocket
  instanceId: string
}> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/pty?token=test-token`, 'opencove-pty.v1')
  await new Promise<void>((resolvePromise, rejectPromise) => {
    socket.once('open', resolvePromise)
    socket.once('error', rejectPromise)
  })

  const instanceId = await new Promise<string>((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(
      () => rejectPromise(new Error('Timed out waiting for hello_ack')),
      2_000,
    )
    socket.once('message', raw => {
      clearTimeout(timeout)
      const message = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)) as {
        type?: string
        server?: { instanceId?: string }
      }
      if (message.type !== 'hello_ack' || !message.server?.instanceId) {
        rejectPromise(new Error(`Unexpected message: ${JSON.stringify(message)}`))
        return
      }
      resolvePromise(message.server.instanceId)
    })
    socket.send(
      JSON.stringify({
        type: 'hello',
        protocolVersion: 1,
        client: { kind: 'cli' },
      }),
    )
  })

  return { socket, instanceId }
}

async function openCookieClient(port: number, cookie: string): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/pty`, 'opencove-pty.v1', {
    headers: {
      cookie,
      origin: `http://127.0.0.1:${port}`,
    },
  })
  await new Promise<void>((resolvePromise, rejectPromise) => {
    socket.once('open', resolvePromise)
    socket.once('error', rejectPromise)
  })
  socket.send(JSON.stringify({ type: 'hello', protocolVersion: 1, client: { kind: 'web' } }))
  return socket
}

async function expectSocketOpen(socket: WebSocket): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => rejectPromise(new Error('Timed out waiting for pong')), 2_000)
    socket.once('pong', () => {
      clearTimeout(timeout)
      resolvePromise()
    })
    socket.ping()
  })
}

describe('Control Surface HTTP listener lifecycle', () => {
  const cleanupPaths: string[] = []

  afterEach(async () => {
    await Promise.all(cleanupPaths.splice(0).map(async path => await rm(path, { recursive: true })))
  })

  it('revokes one Web auth generation without closing private bearer clients', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-control-runtime-auth-'))
    cleanupPaths.push(userDataPath)
    const approvedWorkspaces = createApprovedWorkspaceStoreForPath(
      resolve(userDataPath, 'approved-workspaces.json'),
    )
    const runtime = createControlSurfaceHttpRuntime({
      userDataPath,
      token: 'test-token',
      approvedWorkspaces,
      createPersistenceStore: async () => createInMemoryPersistenceStore(),
      ptyRuntime: createNoopPtyRuntime(),
    })
    runtime.setWebAccessPolicy({ enabled: true, passwordRequired: false })

    const privateListener = runtime.listen({
      hostname: '127.0.0.1',
      bindHostname: '127.0.0.1',
      port: 0,
      role: 'private',
      enableWebShell: false,
      webUiPasswordHash: null,
    })
    const webListener = runtime.listen({
      hostname: '127.0.0.1',
      bindHostname: '127.0.0.1',
      port: 0,
      role: 'web',
      enableWebShell: true,
      webUiPasswordHash: null,
      webAccessGeneration: 7,
    })
    const [privateAddress, webAddress] = await Promise.all([
      privateListener.ready,
      webListener.ready,
    ])

    const ticketResponse = await fetch(`http://127.0.0.1:${privateAddress.port}/invoke`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'query',
        id: 'auth.issueWebSessionTicket',
        payload: { redirectPath: '/' },
      }),
    })
    const ticketEnvelope = (await ticketResponse.json()) as {
      ok?: boolean
      value?: { ticket?: string }
    }
    expect(ticketEnvelope.ok).toBe(true)
    expect(ticketEnvelope.value?.ticket).toEqual(expect.any(String))

    const claimResponse = await fetch(
      `http://127.0.0.1:${webAddress.port}/auth/claim?ticket=${encodeURIComponent(ticketEnvelope.value!.ticket!)}`,
      { redirect: 'manual' },
    )
    const cookie = claimResponse.headers.get('set-cookie')?.split(';')[0] ?? ''
    expect(cookie).toContain('opencove_session=')

    const privateClient = await openClient(privateAddress.port)
    const webClient = await openCookieClient(webAddress.port, cookie)
    const webClosed = new Promise<void>(resolvePromise => webClient.once('close', resolvePromise))

    const rotation = runtime.rotateWebSessionGeneration()
    expect(rotation).toEqual({ previousGeneration: 0, generation: 1 })
    expect(
      runtime.closePtyStreamClients({
        listenerRole: 'web',
        webSessionGeneration: rotation.previousGeneration,
      }),
    ).toBe(1)
    await webClosed
    await expectSocketOpen(privateClient.socket)

    privateClient.socket.close()
    await runtime.dispose()
  })

  it('replaces listeners around one live PTY stream runtime', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-control-runtime-'))
    cleanupPaths.push(userDataPath)
    const approvedWorkspaces = createApprovedWorkspaceStoreForPath(
      resolve(userDataPath, 'approved-workspaces.json'),
    )
    const runtime = createControlSurfaceHttpRuntime({
      userDataPath,
      token: 'test-token',
      approvedWorkspaces,
      createPersistenceStore: async () => createInMemoryPersistenceStore(),
      ptyRuntime: createNoopPtyRuntime(),
    })

    const first = runtime.listen({
      hostname: '127.0.0.1',
      bindHostname: '127.0.0.1',
      port: 0,
      role: 'combined',
      enableWebShell: true,
      webUiPasswordHash: null,
    })

    const firstAddress = await first.ready
    const firstClient = await openClient(firstAddress.port)

    await first.stopAccepting()
    await expectSocketOpen(firstClient.socket)

    const second = runtime.listen({
      hostname: '127.0.0.1',
      bindHostname: '127.0.0.1',
      port: firstAddress.port,
      role: 'combined',
      enableWebShell: true,
      webUiPasswordHash: null,
    })
    const secondAddress = await second.ready
    const secondClient = await openClient(secondAddress.port)

    expect(secondClient.instanceId).toBe(firstClient.instanceId)
    await expectSocketOpen(firstClient.socket)

    firstClient.socket.close()
    secondClient.socket.close()
    await runtime.dispose()
  })
})
