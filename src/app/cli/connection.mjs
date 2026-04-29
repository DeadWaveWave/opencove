import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  CONTROL_SURFACE_CONNECTION_FILE,
  WORKER_CONTROL_SURFACE_CONNECTION_FILE,
} from './constants.mjs'

function isRecord(value) {
  return !!value && typeof value === 'object'
}

function resolveAppDataDir() {
  const platform = process.platform
  const homedir = os.homedir()

  if (platform === 'darwin') {
    return path.join(homedir, 'Library', 'Application Support')
  }

  if (platform === 'win32') {
    return process.env.APPDATA || path.join(homedir, 'AppData', 'Roaming')
  }

  return process.env.XDG_CONFIG_HOME || path.join(homedir, '.config')
}

function resolveUserDataCandidates() {
  const explicitUserDataDir = process.env.OPENCOVE_USER_DATA_DIR
  if (explicitUserDataDir && explicitUserDataDir.trim().length > 0) {
    return [path.resolve(explicitUserDataDir.trim())]
  }

  const candidates = []
  const appDataDir = resolveAppDataDir()
  candidates.push(path.join(appDataDir, 'opencove-dev'))
  candidates.push(path.join(appDataDir, 'opencove'))
  return [...new Set(candidates)]
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

function isProcessAlive(pid) {
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

function normalizeConnectionInfo(value) {
  if (!isRecord(value)) {
    return null
  }

  if (value.version !== 1) {
    return null
  }

  const port = value.port
  const token = value.token
  const hostname = value.hostname
  const pid = value.pid
  const createdAt = value.createdAt

  if (typeof hostname !== 'string' || hostname.length === 0) {
    return null
  }

  if (typeof port !== 'number' || !Number.isFinite(port) || port <= 0) {
    return null
  }

  if (typeof token !== 'string' || token.length === 0) {
    return null
  }

  if (typeof pid !== 'number' || !Number.isFinite(pid) || pid <= 0) {
    return null
  }

  if (typeof createdAt !== 'string' || createdAt.length === 0) {
    return null
  }

  const createdAtMs = Date.parse(createdAt)
  if (!Number.isFinite(createdAtMs)) {
    return null
  }

  return { hostname, port, token, pid, createdAtMs }
}

async function resolveConnectionInfoFromFiles(fileNames) {
  const candidates = resolveUserDataCandidates()
  const results = await Promise.all(
    candidates.flatMap(userDataDir =>
      fileNames.map(async fileName => {
        const filePath = path.join(userDataDir, fileName)

        try {
          const value = await readJsonFile(filePath)
          const info = normalizeConnectionInfo(value)
          if (!info) {
            return null
          }

          if (!isProcessAlive(info.pid)) {
            return null
          }

          return info
        } catch {
          // ignore missing / unreadable / invalid files
          return null
        }
      }),
    ),
  )

  const infos = results.filter(Boolean)
  infos.sort((a, b) => b.createdAtMs - a.createdAtMs)
  return infos[0] || null
}

export async function resolveConnectionInfo() {
  return await resolveConnectionInfoFromFiles([
    CONTROL_SURFACE_CONNECTION_FILE,
    WORKER_CONTROL_SURFACE_CONNECTION_FILE,
  ])
}

export async function resolveWorkerConnectionInfo() {
  return await resolveConnectionInfoFromFiles([WORKER_CONTROL_SURFACE_CONNECTION_FILE])
}
