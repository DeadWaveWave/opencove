import { resolve } from 'node:path'
import { registerControlSurfaceHttpServer } from '../main/controlSurface/controlSurfaceHttpServer'
import { createApprovedWorkspaceStoreForPath } from '../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import { createHeadlessPtyRuntime } from './headlessPtyRuntime'
import { resolveWorkerUserDataDir } from './userData'

function readFlagValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag)
  if (index === -1) {
    return null
  }

  const next = argv[index + 1]
  if (!next || next.startsWith('-')) {
    return null
  }

  return next.trim() || null
}

function resolvePort(argv: string[]): number | null {
  const raw = readFlagValue(argv, '--port')
  if (!raw) {
    return null
  }

  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || value > 65_535) {
    throw new Error(`[worker] invalid --port: ${raw}`)
  }

  return value
}

function readRepeatedFlagValues(argv: string[], flag: string): string[] {
  const values = []

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== flag) {
      continue
    }

    const next = argv[index + 1]
    if (!next || next.startsWith('-')) {
      continue
    }

    const normalized = next.trim()
    if (normalized.length > 0) {
      values.push(normalized)
    }
  }

  return values
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const userDataPath = readFlagValue(argv, '--user-data') ?? resolveWorkerUserDataDir()
  const hostname = readFlagValue(argv, '--hostname') ?? '127.0.0.1'
  const port = resolvePort(argv) ?? 0
  const token = readFlagValue(argv, '--token')

  const approvedWorkspaces = createApprovedWorkspaceStoreForPath(
    resolve(userDataPath, 'approved-workspaces.json'),
  )
  const approvedRoots = readRepeatedFlagValues(argv, '--approve-root')
  await Promise.all(approvedRoots.map(rootPath => approvedWorkspaces.registerRoot(rootPath)))

  const ptyRuntime = createHeadlessPtyRuntime({ userDataPath })

  const server = registerControlSurfaceHttpServer({
    userDataPath,
    hostname,
    port,
    token: token ?? undefined,
    approvedWorkspaces,
    ptyRuntime,
    ownsPtyRuntime: true,
    dbPath: resolve(userDataPath, 'opencove.db'),
    enableWebShell: true,
  })

  const info = await server.ready
  process.stdout.write(`${JSON.stringify(info)}\n`)
  process.stderr.write(`[opencove-worker] web shell: http://${info.hostname}:${info.port}/\n`)
  process.stderr.write(`[opencove-worker] token required (use Authorization: Bearer <token>)\n`)

  const disposeAndExit = (code: number): void => {
    try {
      server.dispose()
    } finally {
      setTimeout(() => process.exit(code), 250).unref()
    }
  }

  process.once('SIGINT', () => disposeAndExit(0))
  process.once('SIGTERM', () => disposeAndExit(0))
}

void main().catch(error => {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  process.stderr.write(`[opencove-worker] ${detail}\n`)
  process.exit(1)
})
