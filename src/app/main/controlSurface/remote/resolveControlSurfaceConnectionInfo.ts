import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ControlSurfaceConnectionInfo } from '../controlSurfaceHttpServer'

const DEFAULT_CONNECTION_FILE = 'control-surface.json'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function resolveControlSurfaceConnectionInfoFromUserData(options: {
  userDataPath: string
  fileName?: string
}): Promise<ControlSurfaceConnectionInfo | null> {
  const fileName = options.fileName ?? DEFAULT_CONNECTION_FILE
  const filePath = resolve(options.userDataPath, fileName)

  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) {
      return null
    }

    if (parsed.version !== 1) {
      return null
    }

    if (typeof parsed.hostname !== 'string' || parsed.hostname.trim().length === 0) {
      return null
    }

    if (typeof parsed.port !== 'number' || !Number.isFinite(parsed.port) || parsed.port <= 0) {
      return null
    }

    if (typeof parsed.token !== 'string' || parsed.token.trim().length === 0) {
      return null
    }

    if (typeof parsed.pid !== 'number' || !Number.isFinite(parsed.pid) || parsed.pid <= 0) {
      return null
    }

    if (!isProcessAlive(parsed.pid)) {
      return null
    }

    if (typeof parsed.createdAt !== 'string' || parsed.createdAt.trim().length === 0) {
      return null
    }

    return {
      version: 1,
      pid: parsed.pid,
      hostname: parsed.hostname.trim(),
      port: parsed.port,
      token: parsed.token.trim(),
      createdAt: parsed.createdAt,
    }
  } catch {
    return null
  }
}
