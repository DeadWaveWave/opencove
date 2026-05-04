#!/usr/bin/env node
/* eslint-disable no-await-in-loop -- debug smoke intentionally launches cases sequentially */

import { chromium } from '@playwright/test'
import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoPath = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const artifactRoot = path.join(repoPath, 'artifacts', 'debug-pnpm-dev-agent-launch')
const port = Number.parseInt(process.env.OPENCOVE_DEV_AGENT_REMOTE_DEBUGGING_PORT ?? '9436', 10)
const keepUserData = process.env.OPENCOVE_DEV_AGENT_KEEP_USER_DATA === '1'
const provider = process.env.OPENCOVE_DEV_AGENT_PROVIDER ?? 'codex'
const pnpmCommand = process.env.OPENCOVE_DEV_AGENT_PNPM_COMMAND ?? 'pnpm'

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

async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true })
}

async function createUserDataDir() {
  return await mkdtemp(path.join(tmpdir(), 'opencove-pnpm-dev-agent-'))
}

function workspaceState(workspaceId, spaceId, mountId) {
  return {
    formatVersion: 1,
    activeWorkspaceId: workspaceId,
    workspaces: [
      {
        id: workspaceId,
        name: 'pnpm dev agent',
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

async function seedUserData(userDataDir, ids) {
  await ensureDir(userDataDir)
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
}

function toFileUri(filePath) {
  return `file:///${filePath.replaceAll('\\', '/')}`
}

async function waitForCdp() {
  const startedAt = Date.now()
  let lastError = null
  while (Date.now() - startedAt < 90_000) {
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
  throw new Error(`[pnpm-dev-agent] timed out waiting for CDP: ${lastError}`)
}

async function killProcessTree(pid) {
  if (!pid) {
    return
  }
  await new Promise(resolve => {
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () =>
      resolve(),
    )
  })
}

async function listAgentProcessPids() {
  if (process.platform !== 'win32') {
    return new Set()
  }

  const command = [
    '$items = Get-CimInstance Win32_Process |',
    "Where-Object { $_.Name -in @('codex.exe','claude.exe','node.exe') -and",
    "($_.CommandLine -match 'codex|claude') } |",
    'Select-Object -ExpandProperty ProcessId;',
    '$items -join ","',
  ].join(' ')

  const stdout = await new Promise(resolve => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { encoding: 'utf8', windowsHide: true },
      (_error, output) => resolve(typeof output === 'string' ? output : ''),
    )
  })

  return new Set(
    stdout
      .split(',')
      .map(value => Number.parseInt(value.trim(), 10))
      .filter(value => Number.isFinite(value)),
  )
}

function assertWindowsNativeLaunch(result) {
  if (process.platform !== 'win32') {
    return
  }

  if (result.runtimeKind !== 'windows') {
    throw new Error(`[pnpm-dev-agent] expected Windows runtime: ${JSON.stringify(result)}`)
  }

  if (result.profileId !== null && result.profileId !== undefined) {
    throw new Error(`[pnpm-dev-agent] expected null profileId: ${JSON.stringify(result)}`)
  }

  if (path.basename(String(result.command)).toLowerCase() === 'wsl.exe') {
    throw new Error(`[pnpm-dev-agent] launched through WSL: ${JSON.stringify(result)}`)
  }
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
      async id =>
        await window.opencoveApi.pty.presentationSnapshot({ sessionId: id }).catch(error => ({
          error: error instanceof Error ? error.message : String(error),
        })),
      sessionId,
    )
    const screen = typeof snapshot?.serializedScreen === 'string' ? snapshot.serializedScreen : ''
    if (marker.test(screen)) {
      return snapshot
    }
    await delay(250)
  }

  throw new Error(
    `[pnpm-dev-agent] ${provider} did not render expected screen: ${JSON.stringify(snapshot)}`,
  )
}

async function launchDirectAgent(page) {
  return await page.evaluate(async payload => await window.opencoveApi.agent.launch(payload), {
    cwd: repoPath,
    provider,
    profileId: 'wsl:Ubuntu',
    prompt: '',
    mode: 'new',
    model: null,
    agentFullAccess: true,
    cols: 80,
    rows: 24,
  })
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

async function runLaunchCase(page, name, launch) {
  const beforePids = await listAgentProcessPids()
  const result = await launch()
  assertWindowsNativeLaunch(result)
  const snapshot = await waitForProviderScreen(page, result.sessionId)

  await page.evaluate(
    async sessionId => await window.opencoveApi.pty.kill({ sessionId }).catch(() => undefined),
    result.sessionId,
  )
  await delay(2_000)

  const afterPids = await listAgentProcessPids()
  const leakedPids = [...afterPids].filter(pid => !beforePids.has(pid))
  if (leakedPids.length > 0) {
    throw new Error(
      `[pnpm-dev-agent] leaked agent processes after ${name}: ${leakedPids.join(',')}`,
    )
  }

  process.stdout.write(
    `[pnpm-dev-agent] ${name} ${JSON.stringify({
      sessionId: result.sessionId,
      profileId: result.profileId ?? null,
      runtimeKind: result.runtimeKind ?? null,
      command: result.command,
      args: result.args,
    })}\n`,
  )

  return {
    name,
    sessionId: result.sessionId,
    profileId: result.profileId ?? null,
    runtimeKind: result.runtimeKind ?? null,
    command: result.command,
    args: result.args,
    title: snapshot.title ?? null,
    screenPreview: snapshot.serializedScreen.slice(0, 240),
  }
}

async function main() {
  await ensureDir(artifactRoot)
  const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const artifactDir = path.join(artifactRoot, runId)
  await ensureDir(artifactDir)

  const ids = {
    workspaceId: 'pnpm-dev-agent-workspace',
    spaceId: 'pnpm-dev-agent-space',
    mountId: 'pnpm-dev-agent-mount',
    targetId: 'pnpm-dev-agent-target',
  }
  const userDataDir = await createUserDataDir()
  const logs = []
  let child = null
  let browser = null

  try {
    await seedUserData(userDataDir, ids)
    const env = cleanEnv({
      ...process.env,
      OPENCOVE_DEV_USER_DATA_DIR: userDataDir,
      OPENCOVE_TERMINAL_DIAGNOSTICS: '1',
      OPENCOVE_TERMINAL_TEST_API: '1',
    })
    delete env.ELECTRON_RUN_AS_NODE

    child = spawn(
      'cmd.exe',
      ['/d', '/s', '/c', `${pnpmCommand} dev --remoteDebuggingPort ${port}`],
      {
        cwd: repoPath,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
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

    const writeResult = await page.evaluate(
      async state => await window.opencoveApi.persistence.writeWorkspaceStateRaw({ raw: state }),
      JSON.stringify(workspaceState(ids.workspaceId, ids.spaceId, ids.mountId)),
    )
    if (!writeResult?.ok) {
      throw new Error(`[pnpm-dev-agent] failed to seed workspace: ${JSON.stringify(writeResult)}`)
    }

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => Boolean(window.opencoveApi?.controlSurface?.invoke), null, {
      timeout: 60_000,
    })

    const workerStatus = await page.evaluate(
      async () => await window.opencoveApi.worker.getStatus(),
    )
    process.stdout.write(`[pnpm-dev-agent] worker ${JSON.stringify(workerStatus)}\n`)

    const availability = await page.evaluate(
      async () => await window.opencoveApi.agent.listInstalledProviders({}),
    )
    process.stdout.write(
      `[pnpm-dev-agent] provider-availability ${JSON.stringify(
        availability.availabilityByProvider?.[provider] ?? null,
      )}\n`,
    )

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
      throw new Error(`[pnpm-dev-agent] no seeded mount: ${JSON.stringify(mounts)}`)
    }

    const results = [
      await runLaunchCase(page, 'direct-agent-ipc', async () => await launchDirectAgent(page)),
      await runLaunchCase(
        page,
        'mount-control-surface',
        async () => await launchMountAgent(page, mountId),
      ),
    ]

    const report = {
      platform: process.platform,
      provider,
      pnpmCommand,
      userDataDir,
      workerStatus,
      availability: availability.availabilityByProvider?.[provider] ?? null,
      results,
    }
    await writeFile(path.join(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    process.stdout.write(`[pnpm-dev-agent] artifacts: ${artifactDir}\n`)
  } finally {
    await writeFile(path.join(artifactDir, 'electron.log'), logs.join(''), 'utf8').catch(
      () => undefined,
    )
    await browser?.close().catch(() => undefined)
    await killProcessTree(child?.pid)
    if (!keepUserData) {
      await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

await main()
