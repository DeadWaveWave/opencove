// @vitest-environment node

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { registerControlSurfaceHttpServer } from '../../../src/app/main/controlSurface/controlSurfaceHttpServer'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import { hashWebUiPassword } from '../../../src/app/main/controlSurface/http/webUiPassword'

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath)
    return true
  } catch {
    return false
  }
}

async function waitForCondition(
  predicate: () => Promise<boolean>,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 2_000
  const intervalMs = options?.intervalMs ?? 50
  const startedAt = Date.now()

  const poll = async (): Promise<void> => {
    if (await predicate()) {
      return
    }

    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error('Timed out waiting for condition.')
    }

    await new Promise(resolveDelay => setTimeout(resolveDelay, intervalMs))
    await poll()
  }

  await poll()
}

async function safeRemoveDirectory(directoryPath: string): Promise<void> {
  try {
    await rm(directoryPath, { recursive: true, force: true })
  } catch (error) {
    const code = error && typeof error === 'object' ? (error as { code?: string }).code : null
    if (code === 'ENOENT') {
      return
    }

    throw error
  }
}

async function disposeAndCleanup(options: {
  server: { dispose: () => void }
  userDataPath: string
  connectionFilePath: string
  baseUrl: string
}): Promise<void> {
  options.server.dispose()

  await waitForCondition(async () => !(await fileExists(options.connectionFilePath)), {
    timeoutMs: 5_000,
  })

  await waitForCondition(
    async () => {
      try {
        await fetch(`${options.baseUrl}/`)
        return false
      } catch {
        return true
      }
    },
    { timeoutMs: 5_000, intervalMs: 100 },
  )

  await waitForCondition(
    async () => {
      try {
        await safeRemoveDirectory(options.userDataPath)
        return true
      } catch {
        return false
      }
    },
    { timeoutMs: 5_000, intervalMs: 100 },
  )
}

function parseCookiePair(headerValue: string | null): string | null {
  if (!headerValue) {
    return null
  }

  const cookiePair = headerValue.split(';')[0]?.trim() ?? null
  return cookiePair && cookiePair.includes('=') ? cookiePair : null
}

describe('Control Surface HTTP server (web session auth)', () => {
  it('exchanges bearer token for a one-time ticket and then cookie (origin guarded)', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-control-surface-'))
    const connectionFileName = 'control-surface.web-auth.test.json'
    const connectionFilePath = resolve(userDataPath, connectionFileName)

    const approvedWorkspaces = createApprovedWorkspaceStoreForPath(
      resolve(userDataPath, 'approved-workspaces.json'),
    )

    const dataListeners = new Set<(event: { sessionId: string; data: string }) => void>()
    const exitListeners = new Set<(event: { sessionId: string; exitCode: number }) => void>()

    const server = registerControlSurfaceHttpServer({
      userDataPath,
      hostname: '127.0.0.1',
      port: 0,
      token: 'test-token',
      connectionFileName,
      approvedWorkspaces,
      ptyRuntime: {
        spawnSession: async () => ({ sessionId: 'test-session' }),
        write: () => undefined,
        resize: () => undefined,
        kill: () => undefined,
        onData: listener => {
          dataListeners.add(listener)
          return () => {
            dataListeners.delete(listener)
          }
        },
        onExit: listener => {
          exitListeners.add(listener)
          return () => {
            exitListeners.delete(listener)
          }
        },
      },
      enableWebShell: true,
    })

    try {
      const info = await server.ready
      const baseUrl = `http://${info.hostname}:${info.port}`

      const issueTicketRes = await fetch(`${baseUrl}/invoke`, {
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

      expect(issueTicketRes.status).toBe(200)
      const issueTicketBody = (await issueTicketRes.json()) as {
        ok?: boolean
        value?: { ticket?: string }
      }
      expect(issueTicketBody.ok).toBe(true)
      const ticket = issueTicketBody.value?.ticket ?? null
      expect(typeof ticket).toBe('string')
      expect((ticket ?? '').length).toBeGreaterThan(10)

      const claimRes = await fetch(
        `${baseUrl}/auth/claim?ticket=${encodeURIComponent(ticket ?? '')}`,
        {
          redirect: 'manual',
        },
      )

      expect(claimRes.status).toBe(302)
      const cookiePair = parseCookiePair(claimRes.headers.get('set-cookie'))
      expect(cookiePair).toContain('opencove_session=')
      expect(claimRes.headers.get('location')).toBe('/')

      const cookiePing = await fetch(`${baseUrl}/invoke`, {
        method: 'POST',
        headers: {
          cookie: cookiePair ?? '',
          origin: baseUrl,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ kind: 'query', id: 'system.ping', payload: null }),
      })
      expect(cookiePing.status).toBe(200)
      const cookiePingBody = (await cookiePing.json()) as { ok?: boolean }
      expect(cookiePingBody.ok).toBe(true)

      const cookieIssueTicket = await fetch(`${baseUrl}/invoke`, {
        method: 'POST',
        headers: {
          cookie: cookiePair ?? '',
          origin: baseUrl,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ kind: 'query', id: 'auth.issueWebSessionTicket', payload: null }),
      })
      expect(cookieIssueTicket.status).toBe(403)

      const wrongOriginPing = await fetch(`${baseUrl}/invoke`, {
        method: 'POST',
        headers: {
          cookie: cookiePair ?? '',
          origin: 'http://127.0.0.1:1',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ kind: 'query', id: 'system.ping', payload: null }),
      })
      expect(wrongOriginPing.status).toBe(401)
    } finally {
      await disposeAndCleanup({
        server,
        userDataPath,
        connectionFilePath,
        baseUrl: `http://127.0.0.1:${(await server.ready).port}`,
      })
    }
  })

  it('supports password login and gates the Web UI', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-control-surface-'))
    const connectionFileName = 'control-surface.web-password.test.json'
    const connectionFilePath = resolve(userDataPath, connectionFileName)

    const approvedWorkspaces = createApprovedWorkspaceStoreForPath(
      resolve(userDataPath, 'approved-workspaces.json'),
    )

    const webUiPasswordHash = await hashWebUiPassword('test-password')

    const server = registerControlSurfaceHttpServer({
      userDataPath,
      hostname: '127.0.0.1',
      port: 0,
      token: 'test-token',
      connectionFileName,
      approvedWorkspaces,
      ptyRuntime: {
        spawnSession: async () => ({ sessionId: 'test-session' }),
        write: () => undefined,
        resize: () => undefined,
        kill: () => undefined,
        onData: () => () => undefined,
        onExit: () => () => undefined,
      },
      enableWebShell: true,
      webUiPasswordHash,
    })

    try {
      const info = await server.ready
      const baseUrl = `http://${info.hostname}:${info.port}`

      const gatedHome = await fetch(`${baseUrl}/`, { redirect: 'manual' })
      expect(gatedHome.status).toBe(302)
      expect(gatedHome.headers.get('location')).toBe('/auth/login?redirectPath=%2F')

      const claimDisabled = await fetch(`${baseUrl}/auth/claim?ticket=anything`, {
        redirect: 'manual',
      })
      expect(claimDisabled.status).toBe(403)

      const wrongPassword = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ password: 'wrong', redirectPath: '/' }).toString(),
        redirect: 'manual',
      })
      expect(wrongPassword.status).toBe(401)

      const okPassword = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ password: 'test-password', redirectPath: '/' }).toString(),
        redirect: 'manual',
      })
      expect(okPassword.status).toBe(302)

      const cookiePair = parseCookiePair(okPassword.headers.get('set-cookie'))
      expect(cookiePair).toContain('opencove_session=')
      expect(okPassword.headers.get('location')).toBe('/')

      const cookiePing = await fetch(`${baseUrl}/invoke`, {
        method: 'POST',
        headers: {
          cookie: cookiePair ?? '',
          origin: baseUrl,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ kind: 'query', id: 'system.ping', payload: null }),
      })
      expect(cookiePing.status).toBe(200)
      const cookiePingBody = (await cookiePing.json()) as { ok?: boolean }
      expect(cookiePingBody.ok).toBe(true)
    } finally {
      await disposeAndCleanup({
        server,
        userDataPath,
        connectionFilePath,
        baseUrl: `http://127.0.0.1:${(await server.ready).port}`,
      })
    }
  })
})
