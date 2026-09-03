import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const PNPM_COMMAND = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

export function isTruthyEnv(rawValue) {
  if (!rawValue) {
    return false
  }
  return rawValue === '1' || rawValue.toLowerCase() === 'true'
}

export function runCommand(args, env = process.env) {
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

export async function waitForMessage(ws, predicate, timeoutMs = 4_000) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      cleanup()
      rejectPromise(new Error('Timed out waiting for websocket message'))
    }, timeoutMs)
    const cleanup = () => {
      clearTimeout(timeout)
      ws.off('message', onMessage)
      ws.off('error', onError)
      ws.off('close', onClose)
    }
    const onError = error => {
      cleanup()
      rejectPromise(error)
    }
    const onClose = () => {
      cleanup()
      rejectPromise(new Error('Socket closed before expected message'))
    }
    const onMessage = raw => {
      const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)
      let parsed
      try {
        parsed = JSON.parse(text)
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

export async function invoke(baseUrl, token, body) {
  const response = await fetch(`${baseUrl}/invoke`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  return {
    status: response.status,
    data: text.trim().length > 0 ? JSON.parse(text) : null,
  }
}

export async function waitForCondition(predicate, timeoutMs = 5_000, intervalMs = 80) {
  const startedAt = Date.now()
  const poll = async () => {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error('Timed out waiting for condition')
    }
    if (await predicate()) {
      return
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, intervalMs))
    return await poll()
  }
  await poll()
}

export function createMinimalState(workspacePath, workspaceId, spaceId) {
  return {
    formatVersion: 1,
    activeWorkspaceId: workspaceId,
    workspaces: [
      {
        id: workspaceId,
        name: 'Presentation Contract Workspace',
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

export function createStateWithTerminalNode({ workspacePath, workspaceId, spaceId, sessionId }) {
  const state = createMinimalState(workspacePath, workspaceId, spaceId)
  const workspace = state.workspaces[0]
  if (!workspace) {
    return state
  }
  workspace.spaces[0].nodeIds = ['terminal-node-1']
  workspace.nodes = [
    {
      id: 'terminal-node-1',
      title: 'Presentation Contract Terminal',
      position: { x: 0, y: 0 },
      width: 640,
      height: 360,
      kind: 'terminal',
      sessionId,
      status: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      executionDirectory: workspacePath,
      expectedDirectory: workspacePath,
      agent: null,
      task: null,
    },
  ]
  return state
}

export async function startWorker(options) {
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
      `--token=${options.token}`,
      '--approve-root',
      options.approvedRoot,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  child.stderr?.on('data', chunk => {
    process.stderr.write(chunk)
  })
  const info = await new Promise((resolvePromise, rejectPromise) => {
    if (!child.stdout) {
      rejectPromise(new Error('Worker stdout not available'))
      return
    }
    const rl = createInterface({ input: child.stdout })
    const timeout = setTimeout(() => {
      rl.close()
      rejectPromise(new Error('Timed out waiting for worker ready payload'))
    }, 7_500)
    rl.on('line', line => {
      try {
        const parsed = JSON.parse(line)
        if (typeof parsed?.hostname === 'string' && typeof parsed?.port === 'number') {
          clearTimeout(timeout)
          rl.close()
          resolvePromise(parsed)
        }
      } catch {
        // Ignore non-JSON output.
      }
    })
    child.once('exit', code => {
      clearTimeout(timeout)
      rl.close()
      rejectPromise(new Error(`Worker exited before ready (code=${code ?? 1})`))
    })
  })
  return { child, info }
}

export async function stopWorker(child) {
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
