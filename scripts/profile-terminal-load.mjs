#!/usr/bin/env node
/* eslint-disable no-await-in-loop -- profiling intentionally samples sequentially */

import { _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  readProcessSample,
  summarizeProcessSample,
} from './lib/terminal-load-profile-processes.mjs'
import {
  installRendererSampler,
  readRendererSample,
  runInteractionProbe,
} from './lib/terminal-load-profile-renderer.mjs'
import {
  createNodes,
  seedProfileUserData,
  seedWorkspace,
  spawnTerminalSessions,
  waitForWorkspace,
} from './lib/terminal-load-profile-workspace.mjs'

const repoPath = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const artifactRoot = path.join(repoPath, 'artifacts', 'terminal-load-profile')
const terminalCount = parsePositiveInt(process.env.OPENCOVE_PROFILE_TERMINAL_COUNT, 10)
const outputIntervalMs = parsePositiveInt(process.env.OPENCOVE_PROFILE_OUTPUT_INTERVAL_MS, 100)
const outputPayloadBytes = parsePositiveInt(process.env.OPENCOVE_PROFILE_OUTPUT_PAYLOAD_BYTES, 160)
const sampleDurationMs = parsePositiveInt(process.env.OPENCOVE_PROFILE_SAMPLE_DURATION_MS, 20_000)
const sampleIntervalMs = parsePositiveInt(process.env.OPENCOVE_PROFILE_SAMPLE_INTERVAL_MS, 1_000)
const windowMode = process.env.OPENCOVE_PROFILE_WINDOW_MODE ?? 'inactive'
const keepUserData = process.env.OPENCOVE_PROFILE_KEEP_USER_DATA === '1'
const terminalDiagnosticsEnabled = process.env.OPENCOVE_PROFILE_TERMINAL_DIAGNOSTICS === '1'
const terminalTestApiEnabled = process.env.OPENCOVE_PROFILE_TERMINAL_TEST_API === '1'
const terminalTranscriptMirrorEnabled =
  process.env.OPENCOVE_PROFILE_TERMINAL_TRANSCRIPT_MIRROR === '1'

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true })
}

async function createUserDataDir() {
  return await mkdtemp(path.join(tmpdir(), 'opencove-terminal-load-profile-'))
}

async function launchProfiledApp(userDataDir, logs) {
  const env = { ...process.env }
  delete env.__CFBundleIdentifier
  delete env.ELECTRON_RUN_AS_NODE

  const homeDir = path.join(userDataDir, 'home')
  const configDir = path.join(userDataDir, 'config')
  const cacheDir = path.join(userDataDir, 'cache')
  const runtimeDir = path.join(userDataDir, 'runtime')
  const appDataDir = path.join(userDataDir, 'app-data')
  const localAppDataDir = path.join(userDataDir, 'local-app-data')
  await Promise.all(
    [homeDir, configDir, cacheDir, runtimeDir, appDataDir, localAppDataDir].map(dir =>
      mkdir(dir, { recursive: true }),
    ),
  )

  const electronApp = await electron.launch({
    args: [repoPath],
    timeout: 60_000,
    env: {
      ...env,
      NODE_ENV: 'test',
      HOME: homeDir,
      USERPROFILE: homeDir,
      APPDATA: appDataDir,
      LOCALAPPDATA: localAppDataDir,
      XDG_CONFIG_HOME: configDir,
      XDG_CACHE_HOME: cacheDir,
      XDG_RUNTIME_DIR: runtimeDir,
      PSModuleAnalysisCachePath: path.join(
        localAppDataDir,
        'Microsoft',
        'Windows',
        'PowerShell',
        'ModuleAnalysisCache',
      ),
      OPENCOVE_TEST_WORKSPACE: repoPath,
      OPENCOVE_TEST_USER_DATA_DIR: userDataDir,
      OPENCOVE_TEST_NODE_EXECUTABLE: process.execPath,
      OPENCOVE_TERMINAL_TEST_API: terminalTestApiEnabled ? '1' : '0',
      OPENCOVE_TERMINAL_DIAGNOSTICS: terminalDiagnosticsEnabled ? '1' : '0',
      OPENCOVE_DISABLE_TERMINAL_TRANSCRIPT_MIRROR: terminalTranscriptMirrorEnabled ? '0' : '1',
      OPENCOVE_E2E_WINDOW_MODE: windowMode,
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
  return { electronApp, window }
}

async function main() {
  await ensureDir(artifactRoot)
  const runId = new Date().toISOString().replace(/[:.]/g, '-')
  const artifactDir = path.join(artifactRoot, runId)
  await ensureDir(artifactDir)

  const userDataDir = await createUserDataDir()
  const logs = []
  const samples = []
  let electronApp = null
  let windowPage = null
  let runError = null

  try {
    await seedProfileUserData({ userDataDir, repoPath })
    const launched = await launchProfiledApp(userDataDir, logs)
    electronApp = launched.electronApp
    const window = launched.window
    windowPage = window
    const rootPid = electronApp.process()?.pid

    await seedWorkspace(window, { repoPath, nodes: [] })
    await waitForWorkspace(window)
    const sessionIds = await spawnTerminalSessions(window, {
      repoPath,
      terminalCount,
      outputIntervalMs,
      outputPayloadBytes,
      sampleDurationMs,
    })
    await seedWorkspace(window, { repoPath, nodes: createNodes(sessionIds, { repoPath }) })
    await waitForWorkspace(window)
    await installRendererSampler(window)

    await window.waitForFunction(
      expectedCount => document.querySelectorAll('.terminal-node .xterm').length >= expectedCount,
      terminalCount,
      { timeout: 60_000 },
    )

    if (terminalTestApiEnabled) {
      await window.waitForFunction(
        expectedCount =>
          (window.__opencoveTerminalSelectionTestApi?.getRegisteredNodeIds?.() ?? []).length >=
          expectedCount,
        terminalCount,
        { timeout: 60_000 },
      )
    }

    const startedAt = Date.now()
    let interactionRan = false
    while (Date.now() - startedAt < sampleDurationMs) {
      if (!interactionRan && Date.now() - startedAt > Math.floor(sampleDurationMs / 2)) {
        interactionRan = true
        await runInteractionProbe(window)
      }

      const renderer = await readRendererSample(window)
      const processes = rootPid ? await readProcessSample(rootPid) : []
      const sample = {
        elapsedMs: Date.now() - startedAt,
        renderer,
        processSummary: summarizeProcessSample(processes),
        processes,
      }
      samples.push(sample)
      process.stdout.write(
        `[terminal-load-profile] sample ${samples.length}: ${JSON.stringify({
          elapsedMs: sample.elapsedMs,
          terminalNodes: renderer.terminalNodes,
          xterms: renderer.xterms,
          frameP95: renderer.frameDeltaMs.p95,
          longTasks: renderer.longTasks.count,
          processSummary: sample.processSummary,
        })}\n`,
      )
      await delay(sampleIntervalMs)
    }

    await window.screenshot({ path: path.join(artifactDir, 'terminal-load.png') })
  } catch (error) {
    runError = {
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    }
    if (windowPage) {
      await windowPage
        .screenshot({ path: path.join(artifactDir, 'failure.png'), fullPage: true })
        .catch(() => undefined)
      await windowPage
        .content()
        .then(html => writeFile(path.join(artifactDir, 'failure.html'), html, 'utf8'))
        .catch(() => undefined)
    }
    throw error
  } finally {
    const report = {
      config: {
        terminalCount,
        outputIntervalMs,
        outputPayloadBytes,
        sampleDurationMs,
        sampleIntervalMs,
        windowMode,
        userDataDir,
        terminalDiagnosticsEnabled,
        terminalTestApiEnabled,
        terminalTranscriptMirrorEnabled,
      },
      samples,
      error: runError,
    }
    await writeFile(path.join(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    await writeFile(path.join(artifactDir, 'electron.log'), `${logs.join('\n')}\n`)
    process.stdout.write(`[terminal-load-profile] artifacts: ${artifactDir}\n`)
    await electronApp?.close().catch(() => undefined)
    if (!keepUserData) {
      await rm(userDataDir, { recursive: true, force: true })
    }
  }
}

await main()
