#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'

const PNPM_COMMAND = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

function isTruthyEnv(rawValue) {
  if (!rawValue) {
    return false
  }

  return rawValue === '1' || rawValue.toLowerCase() === 'true'
}

function runCommand(args, env = process.env) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(PNPM_COMMAND, args, {
      cwd: process.cwd(),
      env,
      shell: process.platform === 'win32',
      stdio: 'inherit',
      windowsHide: true,
    })

    child.on('error', rejectPromise)
    child.on('close', code => {
      resolvePromise(typeof code === 'number' ? code : 1)
    })
  })
}

async function startWorker(options) {
  const child = spawn(
    PNPM_COMMAND,
    [
      'exec',
      'electron',
      options.workerPath,
      '--hostname',
      '127.0.0.1',
      '--port',
      '0',
      '--user-data',
      options.userDataPath,
      '--token',
      options.token,
      '--approve-root',
      options.approvedRoot,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        ...(options.agentStubScriptPath
          ? { OPENCOVE_TEST_AGENT_STUB_SCRIPT: options.agentStubScriptPath }
          : {}),
        ...(options.agentSessionScenario
          ? { OPENCOVE_TEST_AGENT_SESSION_SCENARIO: options.agentSessionScenario }
          : {}),
        ...(options.nodeEnv ? { NODE_ENV: options.nodeEnv } : {}),
      },
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )

  child.stderr?.on('data', chunk => {
    process.stderr.write(chunk)
  })

  const ready = new Promise((resolvePromise, rejectPromise) => {
    if (!child.stdout) {
      rejectPromise(new Error('[web-canvas-e2e] Worker stdout not available'))
      return
    }

    const rl = createInterface({ input: child.stdout })
    const timeout = setTimeout(() => {
      rl.close()
      rejectPromise(new Error('[web-canvas-e2e] Timed out waiting for worker ready payload'))
    }, 7_500)

    rl.on('line', line => {
      try {
        const info = JSON.parse(line)
        const hostname = info && typeof info.hostname === 'string' ? info.hostname : null
        const port = info && typeof info.port === 'number' ? info.port : null
        if (!hostname || !port) {
          return
        }

        clearTimeout(timeout)
        rl.close()
        resolvePromise({ hostname, port })
      } catch {
        // Ignore non-JSON output.
      }
    })

    child.once('exit', code => {
      clearTimeout(timeout)
      rl.close()
      rejectPromise(new Error(`[web-canvas-e2e] Worker exited before ready (code=${code ?? 1})`))
    })
  })

  const info = await ready
  return { child, info }
}

async function stopWorker(child) {
  if (!child || child.killed) {
    return
  }

  await new Promise(resolvePromise => {
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

async function main() {
  const forwardedArgsRaw = process.argv.slice(2)
  const forwardedArgs = forwardedArgsRaw[0] === '--' ? forwardedArgsRaw.slice(1) : forwardedArgsRaw

  if (!isTruthyEnv(process.env['OPENCOVE_E2E_SKIP_BUILD'])) {
    const buildCode = await runCommand(['build'])
    if (buildCode !== 0) {
      process.exit(buildCode)
    }
  }

  const workerPath = resolve(process.cwd(), 'out', 'main', 'worker.js')
  const userDataPath = await mkdtemp(resolve(tmpdir(), 'opencove-web-canvas-userdata-'))
  const workspaceRoot = await mkdtemp(resolve(tmpdir(), 'opencove-web-canvas-workspace-'))
  const token = randomBytes(16).toString('hex')
  const agentStubScriptPath = resolve(process.cwd(), 'scripts', 'test-agent-session-stub.mjs')

  let worker = null
  let exitCode = 1

  try {
    const started = await startWorker({
      workerPath,
      userDataPath,
      approvedRoot: workspaceRoot,
      token,
      nodeEnv: 'test',
      agentStubScriptPath,
      agentSessionScenario: 'codex-standby-only',
    })

    worker = started.child
    const baseUrl = `http://${started.info.hostname}:${started.info.port}`

    const testEnv = {
      ...process.env,
      OPENCOVE_WEB_CANVAS_BASE_URL: baseUrl,
      OPENCOVE_WEB_CANVAS_TOKEN: token,
      OPENCOVE_WEB_CANVAS_WORKSPACE_ROOT: workspaceRoot,
    }

    exitCode = await runCommand(
      [
        'exec',
        'playwright',
        'test',
        '--config',
        'playwright.web-canvas.config.ts',
        ...forwardedArgs,
      ],
      testEnv,
    )
  } finally {
    await stopWorker(worker)
    await rm(userDataPath, { recursive: true, force: true })
    await rm(workspaceRoot, { recursive: true, force: true })
  }

  process.exit(exitCode)
}

void main().catch(error => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  process.stderr.write(`${message}\n`)
  process.exit(1)
})
