// @vitest-environment node

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { registerControlSurfaceHttpServer } from '../../../src/app/main/controlSurface/controlSurfaceHttpServer'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'

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

describe('Control Surface HTTP server (worker web surfaces)', () => {
  it('serves the full web UI at /, exposes the debug shell at /debug/shell, and enforces bearer token for POST /invoke', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-control-surface-'))
    const connectionFileName = 'control-surface.test.json'
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

      await waitForCondition(async () => await fileExists(connectionFilePath))
      const connectionRaw = await readFile(connectionFilePath, 'utf8')
      const connection = JSON.parse(connectionRaw) as { token?: unknown }
      expect(connection.token).toBe('test-token')

      const baseUrl = `http://${info.hostname}:${info.port}`

      const rootRes = await fetch(`${baseUrl}/`)
      expect(rootRes.status).toBe(200)
      const rootHtml = await rootRes.text()
      expect(rootHtml).toContain('<title>OpenCove Web</title>')
      expect(rootHtml).toContain('<div id="root"></div>')

      const debugShellRes = await fetch(`${baseUrl}/debug/shell`)
      expect(debugShellRes.status).toBe(200)
      const debugShellHtml = await debugShellRes.text()
      expect(debugShellHtml).toContain('<title>OpenCove Worker Shell</title>')
      expect(debugShellHtml).toContain('POST <code>/invoke</code>')
      expect(debugShellHtml).toContain("fetch('/invoke'")

      const missingToken = await fetch(`${baseUrl}/invoke`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ kind: 'query', id: 'system.ping', payload: null }),
      })
      expect(missingToken.status).toBe(401)
      const missingTokenBody = (await missingToken.json()) as {
        ok: boolean
        error?: { code?: string }
      }
      expect(missingTokenBody.ok).toBe(false)
      expect(missingTokenBody.error?.code).toBe('control_surface.unauthorized')

      const okRes = await fetch(`${baseUrl}/invoke`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ kind: 'query', id: 'system.ping', payload: null }),
      })
      expect(okRes.status).toBe(200)
      const okBody = (await okRes.json()) as { ok: boolean; value?: { ok?: boolean } }
      expect(okBody.ok).toBe(true)
      expect(okBody.value?.ok).toBe(true)
    } finally {
      await disposeAndCleanup({
        server,
        userDataPath,
        connectionFilePath,
        baseUrl: `http://127.0.0.1:${(await server.ready).port}`,
      })
    }
  })

  it('returns 404 for GET / when web shell is disabled', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-control-surface-'))
    const connectionFileName = 'control-surface.disabled.test.json'
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
    })

    try {
      const info = await server.ready
      const baseUrl = `http://${info.hostname}:${info.port}`
      const rootRes = await fetch(`${baseUrl}/`)
      expect(rootRes.status).toBe(404)
    } finally {
      await disposeAndCleanup({
        server,
        userDataPath,
        connectionFilePath,
        baseUrl: `http://127.0.0.1:${(await server.ready).port}`,
      })
    }
  })

  it('returns 400 for invalid JSON payloads', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-control-surface-'))
    const connectionFileName = 'control-surface.invalid-json.test.json'
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
    })

    try {
      const info = await server.ready
      const baseUrl = `http://${info.hostname}:${info.port}`
      const res = await fetch(`${baseUrl}/invoke`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-token',
          'content-type': 'application/json',
        },
        body: '{',
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as { ok: boolean; error?: { code?: string } }
      expect(body.ok).toBe(false)
      expect(body.error?.code).toBe('common.invalid_input')
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
