import { readFile, rm } from 'node:fs/promises'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import WebSocket from 'ws'

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath)
    return true
  } catch {
    return false
  }
}

export async function waitForCondition(
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

export async function safeRemoveDirectory(directoryPath: string): Promise<void> {
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

export async function disposeAndCleanup(options: {
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
        await fetch(`${options.baseUrl}/invoke`, { method: 'POST' })
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

export function toWsUrl(baseUrl: string, path: string, query: Record<string, string>): string {
  const url = new URL(baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = path
  url.search = ''
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value))
  return url.toString()
}

export function sendJson(ws: WebSocket, payload: unknown): void {
  ws.send(JSON.stringify(payload))
}

export async function waitForMessage<T>(
  ws: WebSocket,
  predicate: (message: unknown) => message is T,
  options?: { timeoutMs?: number },
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 2_000

  return await new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      cleanup()
      rejectPromise(new Error('Timed out waiting for WS message'))
    }, timeoutMs)

    const cleanup = (): void => {
      clearTimeout(timer)
      ws.off('message', onMessage)
      ws.off('error', onError)
      ws.off('close', onClose)
    }

    const onError = (error: Error): void => {
      cleanup()
      rejectPromise(error)
    }

    const onClose = (): void => {
      cleanup()
      rejectPromise(new Error('Socket closed before message'))
    }

    const onMessage = (raw: WebSocket.RawData): void => {
      const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)
      let parsed: unknown
      try {
        parsed = JSON.parse(text) as unknown
      } catch {
        return
      }

      if (!predicate(parsed)) {
        return
      }

      cleanup()
      resolvePromise(parsed)
    }

    ws.on('message', onMessage)
    ws.once('error', onError)
    ws.once('close', onClose)
  })
}

export async function invoke(
  baseUrl: string,
  token: string,
  body: unknown,
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${baseUrl}/invoke`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const text = await res.text()
  const data = text.trim().length > 0 ? (JSON.parse(text) as unknown) : null
  return { status: res.status, data }
}

export function createMinimalState(workspacePath: string, workspaceId: string, spaceId: string) {
  return {
    formatVersion: 1,
    activeWorkspaceId: workspaceId,
    workspaces: [
      {
        id: workspaceId,
        name: 'Test Workspace',
        path: workspacePath,
        worktreesRoot: workspacePath,
        pullRequestBaseBranchOptions: [],
        spaceArchiveRecords: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        isMinimapVisible: true,
        spaces: [
          {
            id: spaceId,
            name: 'Main',
            directoryPath: workspacePath,
            labelColor: null,
            nodeIds: [],
            rect: null,
          },
        ],
        activeSpaceId: spaceId,
        nodes: [],
      },
    ],
    settings: {},
  }
}

export function createInMemoryPersistenceStore(): PersistenceStore {
  let state: unknown | null = null
  let revision = 0
  const nodeScrollbacks = new Map<string, string>()

  return {
    readWorkspaceStateRaw: async () => null,
    writeWorkspaceStateRaw: async raw => ({ ok: true, level: 'full', bytes: raw.length }),
    readAppState: async () => state,
    readAppStateRevision: async () => revision,
    writeAppState: async nextState => {
      state = nextState
      revision += 1
      return { ok: true, level: 'full', bytes: 0 }
    },
    readNodeScrollback: async nodeId => nodeScrollbacks.get(nodeId) ?? null,
    writeNodeScrollback: async (nodeId, scrollback) => {
      if (scrollback) {
        nodeScrollbacks.set(nodeId, scrollback)
      } else {
        nodeScrollbacks.delete(nodeId)
      }
      return { ok: true, level: 'full', bytes: scrollback?.length ?? 0 }
    },
    consumeRecovery: () => null,
    dispose: () => undefined,
  }
}
