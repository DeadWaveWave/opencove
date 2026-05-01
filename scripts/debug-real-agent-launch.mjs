#!/usr/bin/env node
/* eslint-disable no-await-in-loop -- debug script intentionally launches providers sequentially */

import { _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoPath = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const artifactRoot = path.join(repoPath, 'artifacts', 'debug-real-agent-launch')
const defaultProviders = ['codex', 'claude-code']
const workerClientEnabled = process.env.OPENCOVE_REAL_AGENT_WORKER_CLIENT !== '0'
const keepUserData = process.env.OPENCOVE_REAL_AGENT_KEEP_USER_DATA === '1'
const providers = parseProviders(process.env.OPENCOVE_REAL_AGENT_PROVIDERS)
const requestedProfiles = parseRequestedProfiles(process.env.OPENCOVE_REAL_AGENT_PROFILES)

function parseProviders(rawValue) {
  const parsed = String(rawValue ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(value => ['codex', 'claude-code', 'opencode', 'gemini'].includes(value))

  return parsed.length > 0 ? parsed : defaultProviders
}

function parseRequestedProfiles(rawValue) {
  const parsed = String(rawValue ?? 'none,wsl:Ubuntu')
    .split(',')
    .map(value => value.trim())
    .filter(value => value.length > 0)
    .map(value => (value === 'none' || value === 'null' ? null : value))

  return parsed.length > 0 ? parsed : [null]
}

function delay(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true })
}

async function createUserDataDir() {
  return await mkdtemp(path.join(tmpdir(), 'opencove-real-agent-launch-'))
}

async function seedUserData(userDataDir) {
  await ensureDir(userDataDir)
  await writeFile(
    path.join(userDataDir, 'approved-workspaces.json'),
    `${JSON.stringify({ version: 1, roots: [repoPath] })}\n`,
    'utf8',
  )

  if (!workerClientEnabled) {
    return
  }

  await writeFile(
    path.join(userDataDir, 'home-worker.json'),
    `${JSON.stringify(
      {
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
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

function createSeededWorkspaceState() {
  const workspaceId = 'real-agent-launch-workspace'
  const spaceId = 'real-agent-launch-space'

  return {
    formatVersion: 1,
    activeWorkspaceId: workspaceId,
    workspaces: [
      {
        id: workspaceId,
        name: 'real agent launch',
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
            targetMountId: null,
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
      defaultProvider: providers[0] ?? 'codex',
      defaultTerminalProfileId: null,
      agentFullAccess: true,
      standardWindowSizeBucket: 'regular',
      terminalFontSize: 13,
      terminalFontFamily: null,
    },
  }
}

async function launchApp(userDataDir, logs) {
  const env = { ...process.env }
  delete env.__CFBundleIdentifier
  delete env.ELECTRON_RUN_AS_NODE

  const electronApp = await electron.launch({
    args: [repoPath],
    timeout: 45_000,
    env: {
      ...env,
      NODE_ENV: 'test',
      OPENCOVE_TEST_USER_DATA_DIR: userDataDir,
      OPENCOVE_TEST_WORKSPACE: repoPath,
      OPENCOVE_TEST_USE_REAL_AGENTS: '1',
      OPENCOVE_TEST_NODE_EXECUTABLE: process.execPath,
      OPENCOVE_E2E_WINDOW_MODE: 'offscreen',
      OPENCOVE_TERMINAL_DIAGNOSTICS: '1',
      OPENCOVE_TERMINAL_TEST_API: '1',
    },
  })

  const child = electronApp.process()
  child.stdout?.on('data', chunk => {
    const text = chunk.toString()
    logs.push(...text.split('\n').filter(Boolean))
    process.stdout.write(text)
  })
  child.stderr?.on('data', chunk => {
    const text = chunk.toString()
    logs.push(...text.split('\n').filter(Boolean))
    process.stderr.write(text)
  })

  const window = await electronApp.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  const writeResult = await window.evaluate(async state => {
    return await window.opencoveApi.persistence.writeWorkspaceStateRaw({
      raw: JSON.stringify(state),
    })
  }, createSeededWorkspaceState())
  if (!writeResult?.ok) {
    throw new Error(`[real-agent] failed to seed workspace: ${JSON.stringify(writeResult)}`)
  }
  await window.reload({ waitUntil: 'domcontentloaded' })
  await window.locator('.workspace-canvas .react-flow__pane').waitFor({
    state: 'visible',
    timeout: 45_000,
  })

  if (workerClientEnabled) {
    await window.evaluate(async () => {
      await window.opencoveApi.worker.start()
    })
  }

  return { electronApp, window }
}

function providerMarker(provider) {
  if (provider === 'claude-code') {
    return /Claude\s+Code|Welcome/i
  }
  if (provider === 'opencode') {
    return /opencode/i
  }
  if (provider === 'gemini') {
    return /Gemini/i
  }
  return /OpenAI\s+Codex|Codex/i
}

async function waitForPresentationSnapshot(window, sessionId, provider) {
  const deadline = Date.now() + 30_000
  let latest = null

  while (Date.now() < deadline) {
    latest = await window.evaluate(async currentSessionId => {
      try {
        return await window.opencoveApi.pty.presentationSnapshot({ sessionId: currentSessionId })
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    }, sessionId)

    const screen =
      latest && typeof latest.serializedScreen === 'string' ? latest.serializedScreen : ''
    if (screen.trim().length > 0 && providerMarker(provider).test(screen)) {
      return latest
    }

    await delay(250)
  }

  throw new Error(
    `[real-agent] ${provider} did not render the expected TUI screen: ${JSON.stringify(latest)}`,
  )
}

function assertWindowsNativeLaunch(result, requestedProfileId) {
  const command = typeof result.command === 'string' ? result.command : ''
  if (process.platform === 'win32' && path.basename(command).toLowerCase() === 'wsl.exe') {
    throw new Error(`[real-agent] launched through WSL unexpectedly: ${JSON.stringify(result)}`)
  }

  if (
    process.platform === 'win32' &&
    typeof requestedProfileId === 'string' &&
    requestedProfileId.toLowerCase().startsWith('wsl:') &&
    typeof result.profileId === 'string' &&
    result.profileId.toLowerCase().startsWith('wsl:')
  ) {
    throw new Error(`[real-agent] stale WSL profile was returned: ${JSON.stringify(result)}`)
  }

  if (
    process.platform === 'win32' &&
    result.runtimeKind !== undefined &&
    result.runtimeKind !== null &&
    result.runtimeKind !== 'windows'
  ) {
    throw new Error(`[real-agent] unexpected Windows runtime kind: ${JSON.stringify(result)}`)
  }
}

async function launchAgentCase(window, provider, requestedProfileId) {
  const result = await window.evaluate(
    async payload =>
      await window.opencoveApi.agent.launch({
        cwd: payload.cwd,
        provider: payload.provider,
        profileId: payload.profileId,
        prompt: '',
        mode: 'new',
        model: null,
        agentFullAccess: true,
        cols: 80,
        rows: 24,
      }),
    { cwd: repoPath, provider, profileId: requestedProfileId },
  )

  assertWindowsNativeLaunch(result, requestedProfileId)
  const snapshot = await waitForPresentationSnapshot(window, result.sessionId, provider)

  await window.evaluate(async sessionId => {
    await window.opencoveApi.pty.kill({ sessionId }).catch(() => undefined)
  }, result.sessionId)

  return {
    provider,
    requestedProfileId,
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

  const userDataDir = await createUserDataDir()
  const logs = []
  let electronApp = null

  try {
    await seedUserData(userDataDir)
    const launched = await launchApp(userDataDir, logs)
    electronApp = launched.electronApp

    const results = []
    for (const provider of providers) {
      for (const requestedProfileId of requestedProfiles) {
        process.stdout.write(
          `[real-agent] launching provider=${provider} requestedProfileId=${
            requestedProfileId ?? 'none'
          }\n`,
        )
        results.push(await launchAgentCase(launched.window, provider, requestedProfileId))
      }
    }

    const report = {
      userDataDir,
      workerClientEnabled,
      platform: process.platform,
      providers,
      requestedProfiles,
      results,
    }
    await writeFile(path.join(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    process.stdout.write(`[real-agent] artifacts: ${artifactDir}\n`)
  } finally {
    await writeFile(path.join(artifactDir, 'electron.log'), `${logs.join('\n')}\n`, 'utf8')
    await electronApp?.close().catch(() => undefined)
    if (!keepUserData) {
      await rm(userDataDir, { recursive: true, force: true }).catch(error => {
        process.stderr.write(
          `[real-agent] skipped locked userData cleanup for ${userDataDir}: ${
            error instanceof Error ? error.message : String(error)
          }\n`,
        )
      })
    }
  }
}

await main()
