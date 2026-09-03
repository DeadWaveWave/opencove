#!/usr/bin/env node

import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import WebSocket from 'ws'
import {
  createMinimalState,
  createStateWithTerminalNode,
  invoke,
  isTruthyEnv,
  runCommand,
  startWorker,
  stopWorker,
  waitForCondition,
  waitForMessage,
} from './terminal-presentation-contract-support.mjs'

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
