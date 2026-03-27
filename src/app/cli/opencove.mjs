#!/usr/bin/env node

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const CONTROL_SURFACE_CONNECTION_FILE = 'control-surface.json'

function isRecord(value) {
  return !!value && typeof value === 'object'
}

function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return 'unknown error'
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
  const candidates = []
  const explicitUserDataDir = process.env.OPENCOVE_USER_DATA_DIR
  if (explicitUserDataDir && explicitUserDataDir.trim().length > 0) {
    candidates.push(path.resolve(explicitUserDataDir.trim()))
  }

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

async function resolveConnectionInfo() {
  const candidates = resolveUserDataCandidates()
  const results = await Promise.all(
    candidates.map(async userDataDir => {
      const filePath = path.join(userDataDir, CONTROL_SURFACE_CONNECTION_FILE)

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
  )

  const infos = results.filter(Boolean)
  infos.sort((a, b) => b.createdAtMs - a.createdAtMs)
  return infos[0] || null
}

async function invokeControlSurface(connection, request, options) {
  const controller = new AbortController()
  const timeoutMs = options?.timeoutMs ?? 2500
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const url = `http://${connection.hostname}:${connection.port}/invoke`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    })

    const raw = await response.text()
    const parsed = raw.trim().length > 0 ? JSON.parse(raw) : null
    return { httpStatus: response.status, result: parsed }
  } finally {
    clearTimeout(timer)
  }
}

function printUsage() {
  process.stdout.write(`OpenCove CLI (dev)\n\n`)
  process.stdout.write(`Usage:\n`)
  process.stdout.write(`  opencove ping [--pretty]\n`)
  process.stdout.write(`  opencove project list [--pretty]\n`)
  process.stdout.write(`  opencove space list [--project <id>] [--pretty]\n\n`)
  process.stdout.write(`  opencove space get --space <id> [--pretty]\n\n`)
  process.stdout.write(`Environment:\n`)
  process.stdout.write(`  OPENCOVE_USER_DATA_DIR=/path/to/userData (optional override)\n`)
}

function readFlagValue(args, flag) {
  const index = args.indexOf(flag)
  if (index === -1) {
    return null
  }

  const next = args[index + 1]
  if (!next || next.startsWith('-')) {
    return null
  }

  return next.trim() || null
}

async function main() {
  const argv = process.argv.slice(2)
  const wantsHelp = argv.includes('--help') || argv.includes('-h')
  const pretty = argv.includes('--pretty')

  const args = argv.filter(arg => arg !== '--pretty' && arg !== '--help' && arg !== '-h')
  const command = args[0] || ''

  if (wantsHelp || command.length === 0) {
    printUsage()
    process.exit(command.length === 0 ? 2 : 0)
  }

  const connection = await resolveConnectionInfo()
  if (!connection) {
    process.stderr.write(
      '[opencove] control surface is not running (no valid connection info found).\n',
    )
    process.exit(2)
  }

  if (command === 'ping') {
    const { result } = await invokeControlSurface(
      connection,
      { kind: 'query', id: 'system.ping', payload: null },
      { timeoutMs: 2500 },
    )

    const output = pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result)
    process.stdout.write(`${output}\n`)

    if (result && result.ok === false) {
      process.exit(1)
    }

    return
  }

  if (command === 'project' && args[1] === 'list') {
    const { result } = await invokeControlSurface(
      connection,
      { kind: 'query', id: 'project.list', payload: null },
      { timeoutMs: 2500 },
    )

    const output = pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result)
    process.stdout.write(`${output}\n`)

    if (result && result.ok === false) {
      process.exit(1)
    }

    return
  }

  if (command === 'space' && args[1] === 'list') {
    const projectId = readFlagValue(args, '--project')
    const payload = projectId ? { projectId } : null

    const { result } = await invokeControlSurface(
      connection,
      { kind: 'query', id: 'space.list', payload },
      { timeoutMs: 2500 },
    )

    const output = pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result)
    process.stdout.write(`${output}\n`)

    if (result && result.ok === false) {
      process.exit(1)
    }

    return
  }

  if (command === 'space' && args[1] === 'get') {
    const spaceId = readFlagValue(args, '--space')
    if (!spaceId) {
      process.stderr.write('[opencove] missing required flag: --space <id>\n')
      printUsage()
      process.exit(2)
    }

    const { result } = await invokeControlSurface(
      connection,
      { kind: 'query', id: 'space.get', payload: { spaceId } },
      { timeoutMs: 2500 },
    )

    const output = pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result)
    process.stdout.write(`${output}\n`)

    if (result && result.ok === false) {
      process.exit(1)
    }

    return
  }

  process.stderr.write(`[opencove] unknown command: ${command}\n`)
  printUsage()
  process.exit(2)
}

main().catch(error => {
  process.stderr.write(`[opencove] failed: ${toErrorMessage(error)}\n`)
  process.exit(1)
})
