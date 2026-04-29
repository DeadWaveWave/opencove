#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import WebSocket from 'ws'

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

async function waitForMessage(ws, predicate, timeoutMs = 4_000) {
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

async function invoke(baseUrl, token, body) {
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

async function waitForCondition(predicate, timeoutMs = 5_000, intervalMs = 80) {
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

function createMinimalState(workspacePath, workspaceId, spaceId) {
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

function createStateWithTerminalNode({ workspacePath, workspaceId, spaceId, sessionId }) {
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
      },
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
  if (!isTruthyEnv(process.env.OPENCOVE_E2E_SKIP_BUILD)) {
    const buildCode = await runCommand(['build'])
    if (buildCode !== 0) {
      process.exit(buildCode)
    }
  }

  const workerPath = resolve(process.cwd(), 'out', 'main', 'worker.js')
  const userDataPath = await mkdtemp(resolve(tmpdir(), 'opencove-terminal-presentation-userdata-'))
  const workspaceRoot = await mkdtemp(
    resolve(tmpdir(), 'opencove-terminal-presentation-workspace-'),
  )
  const token = randomBytes(16).toString('hex')

  let worker = null

  try {
    const started = await startWorker({
      workerPath,
      userDataPath,
      approvedRoot: workspaceRoot,
      token,
    })
    worker = started.child

    const baseUrl = `http://${started.info.hostname}:${started.info.port}`
    const workspaceId = randomUUID()
    const spaceId = randomUUID()

    const writeStateResult = await invoke(baseUrl, token, {
      kind: 'command',
      id: 'sync.writeState',
      payload: { state: createMinimalState(workspaceRoot, workspaceId, spaceId) },
    })
    if (writeStateResult.status !== 200 || writeStateResult.data?.ok !== true) {
      throw new Error(`Failed to write minimal sync state: ${JSON.stringify(writeStateResult)}`)
    }

    const spawnResult = await invoke(baseUrl, token, {
      kind: 'command',
      id: 'session.spawnTerminal',
      payload: {
        spaceId,
        runtime: 'node',
        command: process.execPath,
        args: [
          resolve(process.cwd(), 'scripts', 'test-agent-session-stub.mjs'),
          'codex',
          workspaceRoot,
          'new',
          'contract-model',
          '',
          'stdin-echo',
        ],
        cols: 90,
        rows: 28,
      },
    })
    if (spawnResult.status !== 200 || spawnResult.data?.ok !== true) {
      throw new Error(
        `Failed to spawn presentation contract session: ${JSON.stringify(spawnResult)}`,
      )
    }

    const sessionId = spawnResult.data.value?.sessionId
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error(`Invalid session id: ${JSON.stringify(spawnResult.data)}`)
    }

    let initialSnapshot = null
    await waitForCondition(async () => {
      const response = await invoke(baseUrl, token, {
        kind: 'query',
        id: 'session.presentationSnapshot',
        payload: { sessionId },
      })
      if (response.status !== 200 || response.data?.ok !== true) {
        return false
      }

      initialSnapshot = response.data.value
      return typeof initialSnapshot?.serializedScreen === 'string'
        ? initialSnapshot.serializedScreen.includes('stdin-echo ready')
        : false
    })

    if (!initialSnapshot) {
      throw new Error('Failed to capture initial presentation snapshot')
    }

    if (initialSnapshot.cols !== 90 || initialSnapshot.rows !== 28) {
      throw new Error(`Unexpected initial geometry: ${JSON.stringify(initialSnapshot)}`)
    }

    const ws = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/pty?token=${token}`, [
      'opencove-pty.v1',
    ])

    await new Promise((resolvePromise, rejectPromise) => {
      ws.once('open', resolvePromise)
      ws.once('error', rejectPromise)
    })

    const helloAckPromise = waitForMessage(ws, message => message?.type === 'hello_ack')
    ws.send(JSON.stringify({ type: 'hello', protocolVersion: 1, client: { kind: 'cli' } }))
    await helloAckPromise

    const attachedPromise = waitForMessage(
      ws,
      message => message?.type === 'attached' && message.sessionId === sessionId,
    )
    ws.send(
      JSON.stringify({
        type: 'attach',
        sessionId,
        role: 'controller',
        afterSeq: initialSnapshot.appliedSeq,
      }),
    )
    await attachedPromise

    const viewerWs = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/pty?token=${token}`, [
      'opencove-pty.v1',
    ])

    await new Promise((resolvePromise, rejectPromise) => {
      viewerWs.once('open', resolvePromise)
      viewerWs.once('error', rejectPromise)
    })

    const viewerHelloAckPromise = waitForMessage(viewerWs, message => message?.type === 'hello_ack')
    viewerWs.send(JSON.stringify({ type: 'hello', protocolVersion: 1, client: { kind: 'cli' } }))
    await viewerHelloAckPromise

    const viewerAttachedPromise = waitForMessage(
      viewerWs,
      message =>
        message?.type === 'attached' &&
        message.sessionId === sessionId &&
        message.role === 'viewer',
    )
    viewerWs.send(
      JSON.stringify({
        type: 'attach',
        sessionId,
        role: 'viewer',
        afterSeq: initialSnapshot.appliedSeq,
      }),
    )
    await viewerAttachedPromise

    const afterViewerAttachSnapshot = await invoke(baseUrl, token, {
      kind: 'query',
      id: 'session.presentationSnapshot',
      payload: { sessionId },
    })
    if (afterViewerAttachSnapshot.status !== 200 || afterViewerAttachSnapshot.data?.ok !== true) {
      throw new Error(
        `Failed to fetch presentation snapshot after viewer attach: ${JSON.stringify(afterViewerAttachSnapshot)}`,
      )
    }

    if (
      afterViewerAttachSnapshot.data.value?.cols !== 90 ||
      afterViewerAttachSnapshot.data.value?.rows !== 28
    ) {
      throw new Error(
        `Viewer attach unexpectedly changed geometry: ${JSON.stringify(afterViewerAttachSnapshot.data.value)}`,
      )
    }

    const controllerGeometryPromise = waitForMessage(
      ws,
      message =>
        message?.type === 'geometry' &&
        message.sessionId === sessionId &&
        message.cols === 104 &&
        message.rows === 32 &&
        message.reason === 'frame_commit',
    )
    const viewerGeometryPromise = waitForMessage(
      viewerWs,
      message =>
        message?.type === 'geometry' &&
        message.sessionId === sessionId &&
        message.cols === 104 &&
        message.rows === 32 &&
        message.reason === 'frame_commit',
    )
    ws.send(
      JSON.stringify({
        type: 'resize',
        sessionId,
        cols: 104,
        rows: 32,
        reason: 'frame_commit',
      }),
    )
    await Promise.all([controllerGeometryPromise, viewerGeometryPromise])

    const resizedSnapshot = await invoke(baseUrl, token, {
      kind: 'query',
      id: 'session.presentationSnapshot',
      payload: { sessionId },
    })
    if (resizedSnapshot.status !== 200 || resizedSnapshot.data?.ok !== true) {
      throw new Error(
        `Failed to fetch resized presentation snapshot: ${JSON.stringify(resizedSnapshot)}`,
      )
    }

    if (resizedSnapshot.data.value?.cols !== 104 || resizedSnapshot.data.value?.rows !== 32) {
      throw new Error(
        `Expected canonical geometry after explicit resize: ${JSON.stringify(resizedSnapshot.data.value)}`,
      )
    }

    const echoedPromise = waitForMessage(
      ws,
      message =>
        message?.type === 'data' &&
        message.sessionId === sessionId &&
        typeof message.data === 'string' &&
        message.data.includes('stdin_hex=68656c6c6f2070726573656e746174696f6e20636f6e7472616374'),
      8_000,
    )
    ws.send(
      JSON.stringify({
        type: 'write',
        sessionId,
        data: 'hello presentation contract\r',
      }),
    )

    const echoed = await echoedPromise

    if (!echoed?.data) {
      throw new Error('Missing echoed stdin hex data on attach stream')
    }

    let finalSnapshot = null
    await waitForCondition(async () => {
      const response = await invoke(baseUrl, token, {
        kind: 'query',
        id: 'session.presentationSnapshot',
        payload: { sessionId },
      })
      if (response.status !== 200 || response.data?.ok !== true) {
        return false
      }

      finalSnapshot = response.data.value
      return typeof finalSnapshot?.serializedScreen === 'string'
        ? finalSnapshot.serializedScreen.includes(
            'stdin_hex=68656c6c6f2070726573656e746174696f6e20636f6e7472616374',
          )
        : false
    })

    if (!finalSnapshot) {
      throw new Error('Failed to capture final presentation snapshot')
    }

    if (finalSnapshot.appliedSeq <= initialSnapshot.appliedSeq) {
      throw new Error(
        `Expected appliedSeq to advance: initial=${initialSnapshot.appliedSeq}, final=${finalSnapshot.appliedSeq}`,
      )
    }

    const syncState = await invoke(baseUrl, token, {
      kind: 'query',
      id: 'sync.state',
      payload: null,
    })
    if (syncState.status !== 200 || syncState.data?.ok !== true) {
      throw new Error(`Failed to read sync state revision: ${JSON.stringify(syncState)}`)
    }

    const revision = syncState.data.value?.revision
    if (typeof revision !== 'number') {
      throw new Error(`Invalid sync revision: ${JSON.stringify(syncState.data)}`)
    }

    const writeNodeState = await invoke(baseUrl, token, {
      kind: 'command',
      id: 'sync.writeState',
      payload: {
        baseRevision: revision,
        state: createStateWithTerminalNode({
          workspacePath: workspaceRoot,
          workspaceId,
          spaceId,
          sessionId,
        }),
      },
    })
    if (writeNodeState.status !== 200 || writeNodeState.data?.ok !== true) {
      throw new Error(`Failed to write terminal node state: ${JSON.stringify(writeNodeState)}`)
    }

    const prepared = await invoke(baseUrl, token, {
      kind: 'command',
      id: 'session.prepareOrRevive',
      payload: { workspaceId },
    })
    if (prepared.status !== 200 || prepared.data?.ok !== true) {
      throw new Error(`Failed to prepareOrRevive live session: ${JSON.stringify(prepared)}`)
    }

    const preparedNode = prepared.data.value?.nodes?.[0]
    if (
      !preparedNode ||
      preparedNode.recoveryState !== 'live' ||
      preparedNode.sessionId !== sessionId
    ) {
      throw new Error(
        `prepareOrRevive did not preserve live session truth: ${JSON.stringify(preparedNode)}`,
      )
    }

    viewerWs.close()
    ws.close()
    process.stdout.write('[terminal-presentation-contract] PASS\n')
  } finally {
    await stopWorker(worker)
    await rm(userDataPath, { recursive: true, force: true })
    await rm(workspaceRoot, { recursive: true, force: true })
  }
}

void main().catch(error => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  process.stderr.write(`${message}\n`)
  process.exit(1)
})
