#!/usr/bin/env node
/* eslint-disable no-await-in-loop -- profiling compares real Desktop/Web UI clients sequentially */

import { _electron as electron, chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildTerminalDisplayCalibrationCandidates,
  compareTerminalDisplayMetrics,
  isTerminalDisplayParity,
  scoreTerminalDisplayCalibrationCandidate,
  summarizeTerminalDisplayCalibration,
} from './lib/terminal-display-calibration.mjs'

const repoPath = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const artifactRoot = path.join(repoPath, 'artifacts', 'terminal-display-parity-profile')
const PNPM_COMMAND = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

const nodeId = process.env.OPENCOVE_PROFILE_TERMINAL_NODE_ID ?? 'display-parity-terminal'
const terminalFontSize = parsePositiveInt(process.env.OPENCOVE_PROFILE_TERMINAL_FONT_SIZE, 13)
const terminalWidth = parsePositiveInt(process.env.OPENCOVE_PROFILE_TERMINAL_WIDTH, 640)
const terminalHeight = parsePositiveInt(process.env.OPENCOVE_PROFILE_TERMINAL_HEIGHT, 420)
const webDeviceScaleFactors = parseDeviceScaleFactors(
  process.env.OPENCOVE_PROFILE_WEB_DEVICE_SCALE_FACTORS ?? '1,2',
)
const shouldBuild = !isTruthyEnv(process.env.OPENCOVE_PROFILE_SKIP_BUILD)
const shouldKeepUserData = isTruthyEnv(process.env.OPENCOVE_PROFILE_KEEP_USER_DATA)
const shouldAssertParity = isTruthyEnv(process.env.OPENCOVE_PROFILE_ASSERT_PARITY)
const shouldRunWebHeadless = !isTruthyEnv(process.env.OPENCOVE_PROFILE_WEB_HEADFUL)
const shouldCalibrateDisplay = process.env.OPENCOVE_PROFILE_CALIBRATE_DISPLAY !== '0'

function isTruthyEnv(value) {
  return value === '1' || value?.toLowerCase() === 'true'
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseDeviceScaleFactors(value) {
  const parsed = value
    .split(',')
    .map(item => Number.parseFloat(item.trim()))
    .filter(item => Number.isFinite(item) && item > 0)
  return parsed.length > 0 ? parsed : [1]
}

function runCommand(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(PNPM_COMMAND, args, {
      cwd: repoPath,
      env: process.env,
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

async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true })
}

async function createUserDataDir() {
  return await mkdtemp(path.join(tmpdir(), 'opencove-display-parity-'))
}

async function writeHomeWorkerConfig(userDataDir) {
  await writeFile(
    path.join(userDataDir, 'home-worker.json'),
    `${JSON.stringify(
      {
        version: 1,
        mode: 'local',
        remote: null,
        webUi: {
          enabled: true,
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
  await writeFile(
    path.join(userDataDir, 'approved-workspaces.json'),
    `${JSON.stringify({ version: 1, roots: [repoPath] })}\n`,
    'utf8',
  )
}

function createSeededState() {
  const workspaceId = 'display-parity-workspace'
  const spaceId = 'display-parity-space'
  return {
    formatVersion: 1,
    activeWorkspaceId: workspaceId,
    workspaces: [
      {
        id: workspaceId,
        name: 'display parity',
        path: repoPath,
        worktreesRoot: path.join(repoPath, '.opencove', 'worktrees'),
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
            labelColor: null,
            nodeIds: [nodeId],
            rect: null,
          },
        ],
        activeSpaceId: spaceId,
        nodes: [
          {
            id: nodeId,
            title: 'display parity terminal',
            titlePinnedByUser: false,
            position: { x: 120, y: 120 },
            width: terminalWidth,
            height: terminalHeight,
            kind: 'terminal',
            profileId: null,
            runtimeKind: 'posix',
            terminalProviderHint: null,
            labelColorOverride: null,
            status: null,
            startedAt: null,
            endedAt: null,
            exitCode: null,
            lastError: null,
            scrollback: null,
            executionDirectory: repoPath,
            expectedDirectory: repoPath,
            agent: null,
            task: null,
          },
        ],
      },
    ],
    settings: {
      standardWindowSizeBucket: 'regular',
      terminalFontSize,
      terminalFontFamily: null,
    },
  }
}

async function launchDesktop(userDataDir, artifactDir) {
  const env = { ...process.env }
  delete env.__CFBundleIdentifier
  delete env.ELECTRON_RUN_AS_NODE

  const electronApp = await electron.launch({
    args: [repoPath],
    env: {
      ...env,
      NODE_ENV: 'test',
      OPENCOVE_TEST_USER_DATA_DIR: userDataDir,
      OPENCOVE_TEST_WORKSPACE: repoPath,
      OPENCOVE_E2E_WINDOW_MODE: process.env.OPENCOVE_PROFILE_ELECTRON_WINDOW_MODE ?? 'inactive',
      OPENCOVE_WORKER_CLIENT: '1',
      OPENCOVE_TERMINAL_DIAGNOSTICS: '1',
      OPENCOVE_TERMINAL_TEST_API: '1',
    },
  })

  const appProcess = electronApp.process()
  const logs = []
  appProcess.stdout?.on('data', chunk => {
    const text = chunk.toString()
    logs.push(...text.split('\n').filter(Boolean))
    process.stdout.write(text)
  })
  appProcess.stderr?.on('data', chunk => {
    const text = chunk.toString()
    logs.push(...text.split('\n').filter(Boolean))
    process.stderr.write(text)
  })

  const window = await electronApp.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  return {
    electronApp,
    window,
    async flushLogs() {
      await writeFile(path.join(artifactDir, 'desktop.log'), `${logs.join('\n')}\n`, 'utf8')
    },
  }
}

async function seedDesktopWorkspace(window) {
  const writeResult = await window.evaluate(async state => {
    return await window.opencoveApi.persistence.writeWorkspaceStateRaw({
      raw: JSON.stringify(state),
    })
  }, createSeededState())
  if (!writeResult?.ok) {
    throw new Error(`[display-parity] failed to seed workspace: ${JSON.stringify(writeResult)}`)
  }
  await window.reload({ waitUntil: 'domcontentloaded' })
}

async function waitForTerminal(page, label) {
  await page.locator('.workspace-canvas .react-flow__pane').waitFor({
    state: 'visible',
    timeout: 60_000,
  })
  await page.locator('.terminal-node').first().waitFor({ state: 'visible', timeout: 60_000 })
  await page.locator('.terminal-node .xterm').first().waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForFunction(
    currentNodeId => {
      return Boolean(window.__opencoveTerminalSelectionTestApi?.getSize?.(currentNodeId))
    },
    nodeId,
    { timeout: 60_000 },
  )
  process.stdout.write(`[display-parity] ${label} terminal ready\n`)
}

async function getDesktopWebUiUrl(window) {
  await window.evaluate(async () => {
    await window.opencoveApi.worker.start()
  })
  const url = await window.evaluate(async () => await window.opencoveApi.worker.getWebUiUrl())
  if (!url) {
    throw new Error('[display-parity] Desktop did not return a Web UI URL')
  }
  return url
}

function readMetricsInPage(currentNodeId) {
  const api = window.__opencoveTerminalSelectionTestApi
  const nodeElement = [...document.querySelectorAll('.react-flow__node-terminalNode')].find(
    node => {
      if (!(node instanceof HTMLElement)) {
        return false
      }
      return node.getAttribute('data-id') === currentNodeId || node.id.endsWith(currentNodeId)
    },
  )
  const terminalElement =
    nodeElement instanceof HTMLElement
      ? nodeElement.querySelector('.terminal-node__terminal')
      : null
  const xtermElement =
    terminalElement instanceof HTMLElement ? terminalElement.querySelector('.xterm') : null
  const screenElement =
    terminalElement instanceof HTMLElement ? terminalElement.querySelector('.xterm-screen') : null
  const canvasElement =
    screenElement instanceof HTMLElement ? screenElement.querySelector('canvas') : null
  const xtermStyle = xtermElement instanceof HTMLElement ? getComputedStyle(xtermElement) : null

  const rect = element => {
    if (!(element instanceof HTMLElement)) {
      return null
    }
    const box = element.getBoundingClientRect()
    return {
      width: box.width,
      height: box.height,
      left: box.left,
      top: box.top,
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
      offsetWidth: element.offsetWidth,
      offsetHeight: element.offsetHeight,
    }
  }

  return {
    nodeId: currentNodeId,
    userAgent: navigator.userAgent,
    windowDevicePixelRatio: window.devicePixelRatio,
    visualViewportScale: window.visualViewport?.scale ?? null,
    size: api?.getSize?.(currentNodeId) ?? null,
    proposedGeometry: api?.getProposedGeometry?.(currentNodeId) ?? null,
    fontOptions: api?.getFontOptions?.(currentNodeId) ?? null,
    renderMetrics: api?.getRenderMetrics?.(currentNodeId) ?? null,
    nodeRect: rect(nodeElement),
    terminalRect: rect(terminalElement),
    xtermRect: rect(xtermElement),
    screenRect: rect(screenElement),
    canvasRect: rect(canvasElement),
    canvasAttributeSize:
      canvasElement instanceof HTMLCanvasElement
        ? { width: canvasElement.width, height: canvasElement.height }
        : null,
    computedXtermStyle: xtermStyle
      ? {
          fontFamily: xtermStyle.fontFamily,
          fontSize: xtermStyle.fontSize,
          lineHeight: xtermStyle.lineHeight,
          letterSpacing: xtermStyle.letterSpacing,
        }
      : null,
  }
}

async function readMetrics(page, label) {
  const metrics = await page.evaluate(readMetricsInPage, nodeId)
  if (!metrics.size || !metrics.renderMetrics) {
    throw new Error(`[display-parity] ${label} terminal metrics unavailable`)
  }
  return metrics
}

async function applyDisplayCandidate(page, candidate) {
  return await page.evaluate(
    async ({ currentNodeId, nextCandidate }) => {
      const api = window.__opencoveTerminalSelectionTestApi
      if (!api?.setDisplayOptions?.(currentNodeId, nextCandidate)) {
        return false
      }

      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return true
    },
    { currentNodeId: nodeId, nextCandidate: candidate },
  )
}

async function calibrateWebDisplay({ page, label, desktopMetrics, webMetrics }) {
  if (!shouldCalibrateDisplay) {
    return null
  }

  const original = {
    fontSize: webMetrics.fontOptions?.fontSize ?? terminalFontSize,
    lineHeight: webMetrics.fontOptions?.lineHeight ?? 1,
    letterSpacing: webMetrics.fontOptions?.letterSpacing ?? 0,
  }
  const candidates = buildTerminalDisplayCalibrationCandidates({
    baseFontSize: original.fontSize,
  })
  const results = []

  for (const candidate of candidates) {
    if (!(await applyDisplayCandidate(page, candidate))) {
      break
    }
    const candidateMetrics = await readMetrics(page, `${label} calibration`)
    results.push(
      scoreTerminalDisplayCalibrationCandidate({
        targetMetrics: desktopMetrics,
        candidateMetrics,
        candidate,
        preferredCandidate: original,
      }),
    )
  }

  await applyDisplayCandidate(page, original)
  const summary = summarizeTerminalDisplayCalibration(results)
  const best = summary.best
    ? { candidate: summary.best.candidate, score: summary.best.score, deltas: summary.best.deltas }
    : null
  process.stdout.write(
    `[display-parity] ${label} calibration: ${JSON.stringify({
      best,
      candidateCount: summary.candidateCount,
    })}\n`,
  )
  return summary
}

async function profileWebContext({
  browser,
  webUiUrl,
  deviceScaleFactor,
  desktopMetrics,
  artifactDir,
}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor,
  })
  const page = await context.newPage()
  const label = `web-dpr-${String(deviceScaleFactor).replaceAll('.', '-')}`

  try {
    await page.goto(webUiUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const authedOrigin = new URL(page.url()).origin
    await page.goto(`${authedOrigin}/?opencoveTerminalTestApi=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    })
    await waitForTerminal(page, label)
    const webMetrics = await readMetrics(page, label)
    const comparison = compareTerminalDisplayMetrics(desktopMetrics, webMetrics)
    const calibration = await calibrateWebDisplay({ page, label, desktopMetrics, webMetrics })
    await page.screenshot({ path: path.join(artifactDir, `${label}.png`) })
    process.stdout.write(
      `[display-parity] ${label}: ${JSON.stringify({
        desktop: desktopMetrics.size,
        web: webMetrics.size,
        comparison,
      })}\n`,
    )

    if (shouldAssertParity && !isTerminalDisplayParity(comparison)) {
      throw new Error(
        `[display-parity] ${label} parity assertion failed: ${JSON.stringify(comparison)}`,
      )
    }

    return { label, deviceScaleFactor, webMetrics, comparison, calibration }
  } finally {
    await context.close().catch(() => undefined)
  }
}

async function main() {
  if (shouldBuild) {
    const buildCode = await runCommand(['build'])
    if (buildCode !== 0) {
      process.exit(buildCode)
    }
  }

  await ensureDir(artifactRoot)
  const artifactDir = path.join(
    artifactRoot,
    new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-'),
  )
  await ensureDir(artifactDir)

  const userDataDir = await createUserDataDir()
  let desktop = null
  let browser = null

  try {
    await writeHomeWorkerConfig(userDataDir)
    desktop = await launchDesktop(userDataDir, artifactDir)
    await seedDesktopWorkspace(desktop.window)
    await waitForTerminal(desktop.window, 'desktop')
    await desktop.window.screenshot({ path: path.join(artifactDir, 'desktop.png') })
    const desktopMetrics = await readMetrics(desktop.window, 'desktop')
    const webUiUrl = await getDesktopWebUiUrl(desktop.window)

    browser = await chromium.launch({ headless: shouldRunWebHeadless })
    const webProfiles = []
    for (const deviceScaleFactor of webDeviceScaleFactors) {
      const freshWebUiUrl = await getDesktopWebUiUrl(desktop.window)
      webProfiles.push(
        await profileWebContext({
          browser,
          webUiUrl: freshWebUiUrl,
          deviceScaleFactor,
          desktopMetrics,
          artifactDir,
        }),
      )
    }

    const report = {
      userDataDir,
      webUiUrl,
      terminal: {
        nodeId,
        terminalFontSize,
        terminalWidth,
        terminalHeight,
      },
      desktopMetrics,
      webProfiles,
    }
    await writeFile(path.join(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    process.stdout.write(`[display-parity] artifacts: ${artifactDir}\n`)
  } finally {
    await browser?.close().catch(() => undefined)
    await desktop?.flushLogs().catch(() => undefined)
    await desktop?.electronApp.close().catch(() => undefined)
    if (!shouldKeepUserData) {
      await rm(userDataDir, { recursive: true, force: true })
    }
  }
}

await main()
