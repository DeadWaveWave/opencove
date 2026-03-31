import { app } from 'electron'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import type { Readable } from 'node:stream'
import type { WorkerConnectionInfoDto, WorkerStatusResult } from '../../../shared/contracts/dto'
import { resolveControlSurfaceConnectionInfoFromUserData } from '../controlSurface/remote/resolveControlSurfaceConnectionInfo'

function isTruthyEnv(rawValue: string | undefined): boolean {
  if (!rawValue) {
    return false
  }

  return rawValue === '1' || rawValue.toLowerCase() === 'true'
}

function resolveWorkerScriptPath(): string {
  return resolve(app.getAppPath(), 'out', 'main', 'worker.js')
}

function toDto(info: {
  version: number
  pid: number
  hostname: string
  port: number
  token: string
  createdAt: string
}): WorkerConnectionInfoDto {
  return {
    version: info.version,
    pid: info.pid,
    hostname: info.hostname,
    port: info.port,
    token: info.token,
    createdAt: info.createdAt,
  }
}

async function resolveConnectionFromUserData(): Promise<WorkerConnectionInfoDto | null> {
  const info = await resolveControlSurfaceConnectionInfoFromUserData({
    userDataPath: app.getPath('userData'),
  })

  return info ? toDto(info) : null
}

type WorkerChildProcess = ChildProcessByStdio<null, Readable, Readable>

let activeWorkerChild: WorkerChildProcess | null = null

async function stopChild(child: WorkerChildProcess): Promise<void> {
  if (child.killed) {
    return
  }

  await new Promise<void>(resolvePromise => {
    const timeout = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        child.kill()
      }
    }, 3_000)

    child.once('exit', () => {
      clearTimeout(timeout)
      resolvePromise()
    })

    try {
      child.kill('SIGTERM')
    } catch {
      child.kill()
    }
  })
}

async function stopByPid(pid: number): Promise<void> {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid)
    } catch {
      // ignore
    }
  }
}

export async function getLocalWorkerStatus(): Promise<WorkerStatusResult> {
  const connection = await resolveConnectionFromUserData()
  return connection ? { status: 'running', connection } : { status: 'stopped', connection: null }
}

export async function startLocalWorker(): Promise<WorkerStatusResult> {
  const existing = await resolveConnectionFromUserData()
  if (existing) {
    return { status: 'running', connection: existing }
  }

  const workerScriptPath = resolveWorkerScriptPath()
  const userDataPath = app.getPath('userData')
  const args = [
    workerScriptPath,
    '--hostname',
    '127.0.0.1',
    '--port',
    '0',
    '--user-data',
    userDataPath,
  ]

  const child = spawn(process.execPath, args, {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      OPENCOVE_USER_DATA_DIR: userDataPath,
      ...(isTruthyEnv(process.env['OPENCOVE_DEV_USE_SHARED_USER_DATA'])
        ? { OPENCOVE_DEV_USE_SHARED_USER_DATA: '1' }
        : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  activeWorkerChild = child

  child.stderr.on('data', chunk => {
    process.stderr.write(chunk)
  })

  const info = await new Promise<WorkerConnectionInfoDto>((resolvePromise, rejectPromise) => {
    const rl = createInterface({ input: child.stdout })

    const timeout = setTimeout(() => {
      rl.close()
      rejectPromise(new Error('Timed out waiting for worker ready payload'))
    }, 7_500)

    rl.on('line', line => {
      try {
        const parsed = JSON.parse(line) as unknown
        if (!parsed || typeof parsed !== 'object') {
          return
        }

        const record = parsed as Record<string, unknown>
        const hostname = typeof record.hostname === 'string' ? record.hostname : null
        const port = typeof record.port === 'number' ? record.port : null
        const token = typeof record.token === 'string' ? record.token : null
        const pid = typeof record.pid === 'number' ? record.pid : null
        const version = typeof record.version === 'number' ? record.version : null
        const createdAt = typeof record.createdAt === 'string' ? record.createdAt : null

        if (!hostname || !port || !token || !pid || !version || !createdAt) {
          return
        }

        clearTimeout(timeout)
        rl.close()
        resolvePromise({
          version,
          pid,
          hostname,
          port,
          token,
          createdAt,
        })
      } catch {
        // ignore non-JSON output
      }
    })

    child.once('exit', code => {
      clearTimeout(timeout)
      rl.close()
      rejectPromise(new Error(`Worker exited before ready (code=${code ?? 1})`))
    })
  })

  return { status: 'running', connection: info }
}

export async function stopLocalWorker(): Promise<WorkerStatusResult> {
  const child = activeWorkerChild
  activeWorkerChild = null
  if (child) {
    await stopChild(child)
    return { status: 'stopped', connection: null }
  }

  const connection = await resolveConnectionFromUserData()
  if (connection) {
    await stopByPid(connection.pid)
  }

  return await getLocalWorkerStatus()
}
