#!/usr/bin/env node
/* eslint-disable no-await-in-loop -- debug smoke intentionally waits for real app/agent readiness */

import { chromium } from '@playwright/test'
import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoPath = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const artifactRoot = path.join(repoPath, 'artifacts', 'debug-pnpm-dev-stale-worker-lock')
const port = Number.parseInt(process.env.OPENCOVE_STALE_LOCK_REMOTE_DEBUGGING_PORT ?? '9464', 10)
const provider = process.env.OPENCOVE_STALE_LOCK_PROVIDER ?? 'codex'
const keepUserData = process.env.OPENCOVE_STALE_LOCK_KEEP_USER_DATA === '1'

function delay(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

function cleanEnv(base) {
  const next = {}
  for (const [key, value] of Object.entries(base)) {
    if (!key || key.includes('=') || value === undefined) {
      continue
    }
    next[key] = String(value)
  }
  return next
}

async function killProcessTree(pid) {
  if (!pid) {
    return
  }

  await new Promise(resolvePromise => {
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {
      resolvePromise()
    })
  })
}

async function waitForCdp() {
  const deadline = Date.now() + 90_000
  let lastError = null

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) {
        return
      }
      lastError = `${response.status} ${response.statusText}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }

    await delay(500)
  }

  throw new Error(`[stale-worker-lock] timed out waiting for CDP: ${lastError}`)
}

function toFileUri(filePath) {
  return `file:///${filePath.replaceAll('\\', '/')}`
}

function workspaceState(workspaceId, spaceId, mountId) {
  return {
    formatVersion: 1,
    activeWorkspaceId: workspaceId,
    workspaces: [
      {
        id: workspaceId,
        name: 'stale worker lock repro',
        path: repoPath,
        worktreesRoot: '',
        pullRequestBaseBranchOptions: [],
        environmentVariables: {},
        spaceArchiveRecords: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        isMinimapVisible: true,
        spaces: [
          {
            id: spaceId,
            name: 'Main',
            directoryPath: repoPath,
            targetMountId: mountId,
            labelColor: null,
            nodeIds: [],
            rect: null,
          },
        ],
        activeSpaceId: spaceId,
        nodes: [],
      },
    ],
    settings: {
      defaultProvider: provider,
      defaultTerminalProfileId: 'wsl:Ubuntu',
      agentFullAccess: true,
      standardWindowSizeBucket: 'regular',
      terminalFontSize: 13,
      terminalFontFamily: null,
    },
  }
}

async function seedUserData(userDataDir, dummyPid, ids) {
  await mkdir(userDataDir, { recursive: true })
  await writeFile(
    path.join(userDataDir, 'approved-workspaces.json'),
    `${JSON.stringify({ version: 1, roots: [repoPath] })}\n`,
  )
  await writeFile(
    path.join(userDataDir, 'home-worker.json'),
    `${JSON.stringify({
      version: 1,
      mode: 'local',
      remote: null,
      webUi: {
        enabled: false,
        port: null,
        exposeOnLan: false,
        passwordHash: null,
      },
      updatedAt: new Date().toISOString(),
    })}\n`,
  )
  await writeFile(
    path.join(userDataDir, 'worker-topology.json'),
    `${JSON.stringify({
      version: 1,
      endpoints: [],
      mounts: [
        {
          mountId: ids.mountId,
          projectId: ids.workspaceId,
          name: 'opencove',
          sortOrder: 0,
          endpointId: 'local',
          targetId: ids.targetId,
          rootPath: repoPath,
          rootUri: toFileUri(repoPath),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    })}\n`,
  )
  await writeFile(
    path.join(userDataDir, 'worker-endpoint-secrets.json'),
    `${JSON.stringify({ version: 1, tokensByCredentialRef: {} })}\n`,
  )
  await writeFile(
    path.join(userDataDir, 'opencove-worker.lock'),
    `${JSON.stringify({ pid: dummyPid, createdAt: new Date().toISOString() })}\n`,
  )
}

async function waitForWorkerRunning(page) {
  const deadline = Date.now() + 60_000
  let latest = null

  while (Date.now() < deadline) {
    latest = await page.evaluate(async () => await window.opencoveApi.worker.getStatus())
    if (latest?.status === 'running') {
      return latest
    }

    await delay(500)
  }

  throw new Error(`[stale-worker-lock] worker did not recover: ${JSON.stringify(latest)}`)
}

async function waitForProviderScreen(page, sessionId) {
  const marker =
    provider === 'claude-code'
      ? /Claude\s+Code|Welcome/i
      : provider === 'gemini'
        ? /Gemini/i
        : provider === 'opencode'
          ? /opencode/i
          : /OpenAI\s+Codex|Codex/i
  const deadline = Date.now() + 30_000
  let snapshot = null

  while (Date.now() < deadline) {
    snapshot = await page.evaluate(
      async id => await window.opencoveApi.pty.presentationSnapshot({ sessionId: id }),
      sessionId,
    )
    if (marker.test(String(snapshot?.serializedScreen ?? ''))) {
      return snapshot
    }

    await delay(250)
  }

  throw new Error(
    `[stale-worker-lock] ${provider} did not render expected screen: ${JSON.stringify(snapshot)}`,
  )
}

function assertWindowsNativeLaunch(result) {
  if (process.platform !== 'win32') {
    return
  }

  if (result.runtimeKind !== 'windows') {
    throw new Error(`[stale-worker-lock] expected Windows runtime: ${JSON.stringify(result)}`)
  }

  if (result.profileId !== null && result.profileId !== undefined) {
    throw new Error(`[stale-worker-lock] expected null profileId: ${JSON.stringify(result)}`)
  }

  if (path.basename(String(result.command)).toLowerCase() === 'wsl.exe') {
    throw new Error(`[stale-worker-lock] launched through WSL: ${JSON.stringify(result)}`)
  }
}

async function launchMountAgent(page, mountId) {
  return await page.evaluate(
    async payload =>
      await window.opencoveApi.controlSurface.invoke({
        kind: 'command',
        id: 'session.launchAgentInMount',
        payload,
      }),
    {
      mountId,
      cwdUri: toFileUri(repoPath),
      prompt: '',
      provider,
      mode: 'new',
      model: null,
      agentFullAccess: true,
      cols: 80,
      rows: 24,
    },
  )
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('[stale-worker-lock] this repro must run on Windows native')
  }

  await mkdir(artifactRoot, { recursive: true })
  const artifactDir = path.join(
    artifactRoot,
    new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-'),
  )
  await mkdir(artifactDir, { recursive: true })

  const ids = {
    workspaceId: 'stale-worker-lock-workspace',
    spaceId: 'stale-worker-lock-space',
    mountId: 'stale-worker-lock-mount',
    targetId: 'stale-worker-lock-target',
  }
  const dummy = spawn('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 300'], {
    stdio: 'ignore',
    windowsHide: true,
  })
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'opencove-stale-worker-lock-'))
  const logs = []
  let child = null
  let browser = null

  try {
    await seedUserData(userDataDir, dummy.pid, ids)
    const env = cleanEnv({
      ...process.env,
      OPENCOVE_DEV_USER_DATA_DIR: userDataDir,
      OPENCOVE_TERMINAL_DIAGNOSTICS: '1',
      OPENCOVE_TERMINAL_TEST_API: '1',
    })
    delete env.ELECTRON_RUN_AS_NODE

    child = spawn('cmd.exe', ['/d', '/s', '/c', `pnpm dev --remoteDebuggingPort ${port}`], {
      cwd: repoPath,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    child.stdout.on('data', chunk => {
      const text = chunk.toString()
      logs.push(text)
      process.stdout.write(text)
    })
    child.stderr.on('data', chunk => {
      const text = chunk.toString()
      logs.push(text)
      process.stderr.write(text)
    })

    await waitForCdp()
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const context = browser.contexts()[0]
    const page = context.pages()[0] ?? (await context.waitForEvent('page'))
    await page.waitForLoadState('domcontentloaded')
    await page.waitForFunction(() => Boolean(window.opencoveApi?.controlSurface?.invoke), null, {
      timeout: 60_000,
    })

    const workerStatus = await waitForWorkerRunning(page)
    const rawState = JSON.stringify(workspaceState(ids.workspaceId, ids.spaceId, ids.mountId))
    const writeResult = await page.evaluate(
      async state => await window.opencoveApi.persistence.writeWorkspaceStateRaw({ raw: state }),
      rawState,
    )
    if (!writeResult?.ok) {
      throw new Error(
        `[stale-worker-lock] failed to seed workspace: ${JSON.stringify(writeResult)}`,
      )
    }

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => Boolean(window.opencoveApi?.controlSurface?.invoke), null, {
      timeout: 60_000,
    })

    const mounts = await page.evaluate(
      async projectId =>
        await window.opencoveApi.controlSurface.invoke({
          kind: 'query',
          id: 'mount.list',
          payload: { projectId },
        }),
      ids.workspaceId,
    )
    const mountId = mounts.mounts?.[0]?.mountId
    if (!mountId) {
      throw new Error(`[stale-worker-lock] no seeded mount: ${JSON.stringify(mounts)}`)
    }

    const result = await launchMountAgent(page, mountId)
    assertWindowsNativeLaunch(result)
    const snapshot = await waitForProviderScreen(page, result.sessionId)
    const warningSeen = logs
      .join('')
      .includes('Worker lock exists but its connection is not reachable')
    if (!warningSeen) {
      throw new Error('[stale-worker-lock] stale lock warning was not observed')
    }

    await page.evaluate(
      async sessionId => await window.opencoveApi.pty.kill({ sessionId }).catch(() => undefined),
      result.sessionId,
    )

    await writeFile(
      path.join(artifactDir, 'report.json'),
      `${JSON.stringify(
        {
          ok: true,
          platform: process.platform,
          provider,
          userDataDir,
          staleLockPid: dummy.pid,
          workerStatus,
          warningSeen,
          launch: {
            sessionId: result.sessionId,
            profileId: result.profileId ?? null,
            runtimeKind: result.runtimeKind ?? null,
            command: result.command,
            args: result.args,
          },
          screenPreview: String(snapshot.serializedScreen ?? '').slice(0, 240),
        },
        null,
        2,
      )}\n`,
    )
    process.stdout.write(`[stale-worker-lock] passed; artifacts: ${artifactDir}\n`)
  } finally {
    await writeFile(path.join(artifactDir, 'electron.log'), logs.join(''), 'utf8').catch(
      () => undefined,
    )
    await browser?.close().catch(() => undefined)
    await killProcessTree(child?.pid)
    await killProcessTree(dummy.pid)
    if (!keepUserData) {
      await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

await main()
