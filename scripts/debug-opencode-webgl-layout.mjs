#!/usr/bin/env node
/* eslint-disable no-await-in-loop -- visual smoke test waits for real Electron and agent output */

import { chromium } from '@playwright/test'
import { execFile, spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createDebugUserDataDir,
  createSingleWorkspaceState,
  seedApprovedLocalWorkerUserData,
} from './debug-dev-workspace.mjs'
import {
  assertOpenCodeWebglGeometry,
  readTerminalGeometry,
} from './debug-terminal-webgl-geometry.mjs'

const repoPath = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const port = Number.parseInt(process.env.OPENCOVE_OPENCODE_WEBGL_PORT ?? '9473', 10)
const pnpmCommand = process.env.OPENCOVE_OPENCODE_WEBGL_PNPM_COMMAND ?? 'pnpm'
const keepUserData = process.env.OPENCOVE_OPENCODE_WEBGL_KEEP_USER_DATA === '1'
const artifactRoot = path.join(repoPath, 'artifacts', 'debug-opencode-webgl-layout')

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
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

function createSeededWorkspaceState() {
  return createSingleWorkspaceState({
    workspaceId: 'opencode-webgl-layout-workspace',
    spaceId: 'opencode-webgl-layout-space',
    name: 'OpenCode WebGL layout',
    workspacePath: repoPath,
    settings: {
      defaultProvider: 'opencode',
      agentProviderOrder: ['claude-code', 'codex', 'opencode', 'gemini'],
      agentFullAccess: true,
      defaultTerminalProfileId: null,
      standardWindowSizeBucket: 'regular',
      terminalFontSize: 13,
      terminalFontFamily: null,
    },
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
  throw new Error(`[opencode-webgl-layout] timed out waiting for CDP: ${lastError}`)
}

async function isCdpAlive() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`)
    return response.ok
  } catch {
    return false
  }
}

async function readTerminalDomSnapshot(page) {
  return await page.evaluate(() => {
    const api = window.__opencoveTerminalSelectionTestApi
    const terminalNodes = [...document.querySelectorAll('.terminal-node')].map(terminalNode => {
      const flowNode =
        terminalNode.closest('.react-flow__node') ?? terminalNode.closest('[data-id]')
      const nodeId =
        flowNode instanceof HTMLElement
          ? (flowNode.getAttribute('data-id') ?? flowNode.id.replace(/^.*__/, ''))
          : null
      return {
        nodeId,
        title: terminalNode.querySelector('.terminal-node__title')?.textContent ?? null,
        status: terminalNode.querySelector('.terminal-node__status')?.textContent ?? null,
        hydrated: !terminalNode
          .querySelector('.terminal-node__terminal')
          ?.classList.contains('terminal-node__terminal--hydrating'),
        runtimeSessionId: nodeId ? (api?.getRuntimeSessionId?.(nodeId) ?? null) : null,
        size: nodeId ? (api?.getSize?.(nodeId) ?? null) : null,
      }
    })
    return {
      terminalCount: terminalNodes.length,
      registeredNodeIds: api?.getRegisteredNodeIds?.() ?? [],
      terminalNodes,
      bodyPreview: document.body.innerText.slice(0, 2_000),
    }
  })
}

async function findEmptyCanvasPoint(page) {
  return await page.evaluate(() => {
    const pane = document.querySelector('.workspace-canvas .react-flow__pane')
    if (!pane) {
      return null
    }
    const rect = pane.getBoundingClientRect()
    const candidates = [
      [0.5, 0.42],
      [0.36, 0.42],
      [0.64, 0.42],
      [0.5, 0.62],
      [0.24, 0.28],
      [0.76, 0.72],
    ]
    for (const [xRatio, yRatio] of candidates) {
      const x = rect.left + rect.width * xRatio
      const y = rect.top + rect.height * yRatio
      const element = document.elementFromPoint(x, y)
      if (element && !element.closest('.react-flow__node, .react-flow__controls')) {
        return { x, y, tag: element.tagName, className: String(element.className ?? '') }
      }
    }
    return null
  })
}

async function launchOpenCodeFromContextMenu(page) {
  const point = await findEmptyCanvasPoint(page)
  if (!point) {
    throw new Error('[opencode-webgl-layout] no empty canvas point found')
  }
  await page.mouse.click(point.x, point.y, { button: 'right' })
  await page.locator('[data-testid="workspace-context-run-agent-provider-toggle"]').click({
    timeout: 15_000,
  })
  await page.locator('[data-testid="workspace-context-run-agent-opencode"]').click({
    timeout: 15_000,
  })
  return point
}

async function waitForNewNode(page, previousNodeIds) {
  const deadline = Date.now() + 60_000
  let latest = null
  while (Date.now() < deadline) {
    latest = await readTerminalDomSnapshot(page)
    const created = latest.terminalNodes.find(
      node => node.nodeId && !previousNodeIds.has(node.nodeId),
    )
    if (created?.nodeId) {
      return { latest, nodeId: created.nodeId }
    }
    await delay(500)
  }
  throw new Error(`[opencode-webgl-layout] new node did not appear: ${JSON.stringify(latest)}`)
}

async function waitForRuntimeSession(page, nodeId) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const snapshot = await readTerminalDomSnapshot(page)
    const node = snapshot.terminalNodes.find(candidate => candidate.nodeId === nodeId)
    if (node?.runtimeSessionId) {
      return node.runtimeSessionId
    }
    await delay(500)
  }
  throw new Error(`[opencode-webgl-layout] runtime session did not attach for ${nodeId}`)
}

async function waitForOpenCodeScreen(page, sessionId) {
  const deadline = Date.now() + 60_000
  let latest = null
  while (Date.now() < deadline) {
    latest = await page.evaluate(
      async id => await window.opencoveApi.pty.presentationSnapshot({ sessionId: id }),
      sessionId,
    )
    if (/opencode/i.test(latest?.serializedScreen ?? '')) {
      return latest
    }
    await delay(500)
  }
  throw new Error(
    `[opencode-webgl-layout] OpenCode screen did not appear: ${JSON.stringify(latest)}`,
  )
}

async function exerciseOpenCodeTui(page, nodeId, artifactDir) {
  const terminal = page.locator(`.react-flow__node[data-id="${nodeId}"] .terminal-node`)
  const body = terminal.locator('.terminal-node__terminal')
  await body.click()
  await page.keyboard.type(
    'Visual layout smoke: keep this long prompt inside the OpenCode node without right-edge clipping.',
    { delay: 1 },
  )
  await page.waitForTimeout(500)
  await terminal.screenshot({ path: path.join(artifactDir, 'new-opencode-node-typed.png') })
  const box = await terminal.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })
  for (let index = 0; index < 3; index += 1) {
    await page.mouse.move(box.x, box.y)
    await page.mouse.wheel(0, index % 2 === 0 ? 480 : -480)
    await page.waitForTimeout(150)
  }
  await terminal.screenshot({ path: path.join(artifactDir, 'new-opencode-node-wheel.png') })
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('[opencode-webgl-layout] this visual smoke test is Windows-native only')
  }
  if (await isCdpAlive()) {
    throw new Error(`[opencode-webgl-layout] remote debugging port ${port} is already in use`)
  }

  const artifactDir = path.join(
    artifactRoot,
    new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-'),
  )
  await mkdir(artifactDir, { recursive: true })
  const userDataDir = await createDebugUserDataDir('opencove-opencode-webgl-layout-')
  await seedApprovedLocalWorkerUserData(userDataDir, repoPath)
  const logs = []
  const env = {
    ...process.env,
    OPENCOVE_DEV_USER_DATA_DIR: userDataDir,
    OPENCOVE_TERMINAL_DIAGNOSTICS: '1',
    OPENCOVE_TERMINAL_TEST_API: '1',
  }
  delete env.ELECTRON_RUN_AS_NODE

  const child = spawn(
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

  let browser = null
  try {
    await waitForCdp()
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const context = browser.contexts()[0]
    const page =
      context.pages().find(candidate => !candidate.url().startsWith('devtools://')) ??
      context.pages()[0] ??
      (await context.waitForEvent('page'))
    await page.waitForLoadState('domcontentloaded')
    await page.waitForFunction(() => Boolean(window.opencoveApi?.worker?.getStatus), null, {
      timeout: 60_000,
    })
    const writeResult = await page.evaluate(
      async state =>
        await window.opencoveApi.persistence.writeWorkspaceStateRaw({
          raw: JSON.stringify(state),
        }),
      createSeededWorkspaceState(),
    )
    if (!writeResult?.ok) {
      throw new Error(
        `[opencode-webgl-layout] failed to seed workspace state: ${JSON.stringify(writeResult)}`,
      )
    }
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('.workspace-canvas .react-flow__pane').waitFor({
      state: 'visible',
      timeout: 60_000,
    })

    const before = await readTerminalDomSnapshot(page)
    const clickPoint = await launchOpenCodeFromContextMenu(page)
    const previousNodeIds = new Set(before.terminalNodes.map(node => node.nodeId).filter(Boolean))
    const created = await waitForNewNode(page, previousNodeIds)
    const runtimeSessionId = await waitForRuntimeSession(page, created.nodeId)
    await waitForOpenCodeScreen(page, runtimeSessionId)
    await page.screenshot({ path: path.join(artifactDir, 'after-launch.png'), fullPage: true })
    await exerciseOpenCodeTui(page, created.nodeId, artifactDir)

    const after = await readTerminalDomSnapshot(page)
    const openCodeNodes = after.terminalNodes.filter(
      node => /opencode/i.test(node.title ?? '') && node.runtimeSessionId,
    )
    const geometries = []
    for (const node of openCodeNodes) {
      const geometry = await readTerminalGeometry(page, node.nodeId, node.runtimeSessionId)
      assertOpenCodeWebglGeometry(geometry, {
        expectCanonicalFrameWidth: node.nodeId === created.nodeId,
      })
      geometries.push(geometry)
    }

    const newNodeLocator = page.locator(
      `.react-flow__node[data-id="${created.nodeId}"] .terminal-node`,
    )
    await newNodeLocator.screenshot({ path: path.join(artifactDir, 'new-opencode-node.png') })
    const report = {
      ok: true,
      platform: process.platform,
      userDataDir,
      clickPoint,
      newNodeId: created.nodeId,
      runtimeSessionId,
      before,
      after,
      geometries,
    }
    await writeFile(path.join(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    process.stdout.write(`[opencode-webgl-layout] passed; artifacts: ${artifactDir}\n`)
  } finally {
    await writeFile(path.join(artifactDir, 'electron.log'), logs.join(''), 'utf8').catch(
      () => undefined,
    )
    await browser?.close().catch(() => undefined)
    await killProcessTree(child.pid)
    if (!keepUserData) {
      await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

await main()
