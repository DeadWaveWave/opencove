#!/usr/bin/env node
/* eslint-disable no-await-in-loop -- smoke test waits for real Electron and agent output */

import { chromium } from '@playwright/test'
import { execFile, spawn } from 'node:child_process'
import { cp, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoPath = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const port = Number.parseInt(process.env.OPENCOVE_DEFAULT_DEV_AGENT_PORT ?? '9444', 10)
const pnpmCommand = process.env.OPENCOVE_DEFAULT_DEV_AGENT_PNPM_COMMAND ?? 'pnpm'
const requestedProvider = process.env.OPENCOVE_DEFAULT_DEV_AGENT_PROVIDER ?? null
const providerMarkers = {
  codex: /OpenAI\s+Codex|Codex/i,
  'claude-code': /Claude\s+Code|Welcome/i,
  gemini: /Gemini/i,
  opencode: /opencode/i,
}
const anyProviderMarker = /OpenAI\s+Codex|Codex|Claude\s+Code|Gemini|opencode|Welcome/i
const artifactRoot = path.join(repoPath, 'artifacts', 'debug-default-dev-agent-launch')

function delay(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
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

async function isCdpAlive() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`)
    return response.ok
  } catch {
    return false
  }
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

  throw new Error(`[default-dev-agent] timed out waiting for CDP: ${lastError}`)
}

async function readDevState(page) {
  return await page.evaluate(async () => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw().catch(() => null)
    const state =
      typeof raw === 'string' && raw.length > 0
        ? (() => {
            try {
              return JSON.parse(raw)
            } catch {
              return null
            }
          })()
        : null
    const nodes = Array.isArray(state?.workspaces?.[0]?.nodes) ? state.workspaces[0].nodes : []
    return {
      defaultProvider: state?.settings?.defaultProvider ?? null,
      agentNodes: nodes
        .filter(node => node?.kind === 'agent')
        .map(node => ({
          id: node.id ?? null,
          title: node.title ?? null,
          sessionId: node.sessionId ?? null,
          status: node.status ?? null,
          lastError: node.lastError ?? null,
          terminalProvider: node.terminalProvider ?? node.agent?.provider ?? null,
          agentLaunchMode: node.agent?.launchMode ?? null,
          resumeSessionId: node.agent?.resumeSessionId ?? null,
          resumeSessionIdVerified: node.agent?.resumeSessionIdVerified ?? null,
        })),
    }
  })
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
      const container = terminalNode.querySelector('.terminal-node__terminal')
      const title = terminalNode.querySelector('.terminal-node__title')?.textContent ?? null
      const status = terminalNode.querySelector('.terminal-node__status')?.textContent ?? null
      const error = terminalNode.querySelector('.terminal-node__error')?.textContent ?? null
      return {
        nodeId,
        title,
        status,
        error,
        text: terminalNode.textContent?.slice(0, 1_000) ?? '',
        hydrated:
          container instanceof HTMLElement
            ? !container.classList.contains('terminal-node__terminal--hydrating')
            : null,
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
    const xRatios = [0.12, 0.22, 0.34, 0.46, 0.58, 0.7, 0.82, 0.94]
    const yRatios = [0.18, 0.3, 0.42, 0.54, 0.66, 0.78, 0.9]
    for (const yRatio of yRatios) {
      for (const xRatio of xRatios) {
        const x = rect.left + rect.width * xRatio
        const y = rect.top + rect.height * yRatio
        const element = document.elementFromPoint(x, y)
        if (!element) {
          continue
        }
        if (element.closest('.react-flow__node, .react-flow__controls, .react-flow__minimap')) {
          continue
        }
        return { x, y, tag: element.tagName, className: String(element.className ?? '') }
      }
    }

    return null
  })
}

async function openAgentFromContextMenu(page) {
  if (!requestedProvider) {
    await page.locator('[data-testid="workspace-context-run-default-agent"]').click({
      timeout: 15_000,
    })
    return { launchedProvider: null, launchedVia: 'default-menu' }
  }

  await page.locator('[data-testid="workspace-context-run-agent-provider-toggle"]').click({
    timeout: 15_000,
  })
  const providerItem = page.locator(
    `[data-testid="workspace-context-run-agent-${requestedProvider}"]`,
  )
  await providerItem.click({ timeout: 15_000 })
  return { launchedProvider: requestedProvider, launchedVia: 'provider-submenu' }
}

async function waitForNewTerminalNode(page, previousNodeIds) {
  const deadline = Date.now() + 60_000
  let latest = null

  while (Date.now() < deadline) {
    latest = await readTerminalDomSnapshot(page)
    const newNodes = latest.terminalNodes.filter(
      node => node.nodeId && !previousNodeIds.has(node.nodeId),
    )

    if (newNodes.length > 0) {
      return { latest, node: newNodes.at(-1) }
    }

    await delay(500)
  }

  throw new Error(`[default-dev-agent] new terminal node did not appear: ${JSON.stringify(latest)}`)
}

async function waitForRuntimeSession(page, nodeId) {
  const deadline = Date.now() + 60_000
  let latest = null

  while (Date.now() < deadline) {
    latest = await readTerminalDomSnapshot(page)
    const node = latest.terminalNodes.find(candidate => candidate.nodeId === nodeId) ?? null
    if (typeof node?.runtimeSessionId === 'string' && node.runtimeSessionId.length > 0) {
      return node.runtimeSessionId
    }
    await delay(500)
  }

  throw new Error(
    `[default-dev-agent] runtime session did not attach for node ${nodeId}: ${JSON.stringify(
      latest,
    )}`,
  )
}

async function waitForProviderScreen(page, sessionId, provider) {
  const marker =
    typeof provider === 'string' && provider in providerMarkers
      ? providerMarkers[provider]
      : anyProviderMarker
  const deadline = Date.now() + 60_000
  let latest = null

  while (Date.now() < deadline) {
    latest = await page.evaluate(
      async id =>
        await window.opencoveApi.pty.presentationSnapshot({ sessionId: id }).catch(error => ({
          error: error instanceof Error ? error.message : String(error),
        })),
      sessionId,
    )
    const screen = typeof latest?.serializedScreen === 'string' ? latest.serializedScreen : ''
    if (marker.test(screen)) {
      return latest
    }
    await delay(500)
  }

  throw new Error(
    `[default-dev-agent] provider screen did not appear for ${provider ?? 'default'} ${sessionId}: ${JSON.stringify(
      latest,
    )}`,
  )
}

async function readTerminalGeometry(page, nodeId, sessionId) {
  return await page.evaluate(
    async ({ currentNodeId, currentSessionId }) => {
      const api = window.__opencoveTerminalSelectionTestApi
      const flowNode = [...document.querySelectorAll('.react-flow__node')].find(node => {
        if (!(node instanceof HTMLElement)) {
          return false
        }
        return node.getAttribute('data-id') === currentNodeId || node.id.endsWith(currentNodeId)
      })
      const terminalNode =
        flowNode instanceof HTMLElement ? flowNode.querySelector('.terminal-node') : null
      const container =
        terminalNode instanceof HTMLElement
          ? terminalNode.querySelector('.terminal-node__terminal')
          : null
      const xterm = container instanceof HTMLElement ? container.querySelector('.xterm') : null
      const screen =
        container instanceof HTMLElement ? container.querySelector('.xterm-screen') : null
      const canvas = screen instanceof HTMLElement ? screen.querySelector('canvas') : null
      const rect = element => {
        if (!(element instanceof HTMLElement)) {
          return null
        }
        const box = element.getBoundingClientRect()
        return {
          width: box.width,
          height: box.height,
          clientWidth: element.clientWidth,
          clientHeight: element.clientHeight,
          offsetWidth: element.offsetWidth,
          offsetHeight: element.offsetHeight,
        }
      }
      const terminalSize = api?.getSize?.(currentNodeId) ?? null
      const proposedGeometry = api?.getProposedGeometry?.(currentNodeId) ?? null
      const renderMetrics = api?.getRenderMetrics?.(currentNodeId) ?? null
      const fontOptions = api?.getFontOptions?.(currentNodeId) ?? null
      const snapshot = await window.opencoveApi.pty
        .presentationSnapshot({ sessionId: currentSessionId })
        .catch(() => null)
      const contentWidth =
        terminalSize && renderMetrics?.cssCellWidth && renderMetrics.cssCellWidth > 0
          ? terminalSize.cols * renderMetrics.cssCellWidth
          : null
      const contentHeight =
        terminalSize && renderMetrics?.cssCellHeight && renderMetrics.cssCellHeight > 0
          ? terminalSize.rows * renderMetrics.cssCellHeight
          : null
      const containerRect = rect(container)

      return {
        nodeId: currentNodeId,
        sessionId: currentSessionId,
        terminalSize,
        proposedGeometry,
        snapshotSize: snapshot ? { cols: snapshot.cols, rows: snapshot.rows } : null,
        renderMetrics,
        fontOptions,
        flowNodeRect: rect(flowNode),
        terminalNodeRect: rect(terminalNode),
        containerRect,
        xtermRect: rect(xterm),
        screenRect: rect(screen),
        canvasRect: rect(canvas),
        canvasAttributeSize:
          canvas instanceof HTMLCanvasElement
            ? { width: canvas.width, height: canvas.height }
            : null,
        horizontalOverflowPx:
          contentWidth === null || !containerRect
            ? null
            : Math.max(0, contentWidth - containerRect.clientWidth),
        verticalOverflowPx:
          contentHeight === null || !containerRect
            ? null
            : Math.max(0, contentHeight - containerRect.clientHeight),
      }
    },
    { currentNodeId: nodeId, currentSessionId: sessionId },
  )
}

function inferExpectedProvider({ createdNodeTitle, defaultProvider }) {
  if (requestedProvider) {
    return requestedProvider
  }

  if (/Claude/i.test(createdNodeTitle ?? '')) {
    return 'claude-code'
  }

  return defaultProvider
}

async function backupDefaultDevUserData(artifactDir) {
  if (process.platform !== 'win32') {
    return null
  }

  const appData = process.env.APPDATA
  if (!appData) {
    return null
  }

  const userDataDir = path.join(appData, 'opencove-dev')
  const backupDir = path.join(artifactDir, 'opencove-dev-backup')
  await cp(userDataDir, backupDir, { recursive: true, force: true }).catch(() => undefined)
  return { userDataDir, backupDir }
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('[default-dev-agent] this smoke test is Windows-native only')
  }

  const artifactDir = path.join(
    artifactRoot,
    new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-'),
  )
  await mkdir(artifactDir, { recursive: true })
  if (await isCdpAlive()) {
    throw new Error(
      `[default-dev-agent] remote debugging port ${port} is already in use; close the existing dev app or set OPENCOVE_DEFAULT_DEV_AGENT_PORT`,
    )
  }

  const userData = await backupDefaultDevUserData(artifactDir)
  const logs = []
  const env = {
    ...process.env,
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

    const before = {
      appState: await readDevState(page),
      dom: await readTerminalDomSnapshot(page),
      worker: await page.evaluate(
        async () =>
          await window.opencoveApi.worker.getStatus().catch(error => ({
            error: error instanceof Error ? error.message : String(error),
          })),
      ),
      providerAvailability: await page.evaluate(
        async () =>
          await window.opencoveApi.agent.listInstalledProviders({}).catch(error => ({
            error: error instanceof Error ? error.message : String(error),
          })),
      ),
    }

    const point = await findEmptyCanvasPoint(page)
    if (!point) {
      throw new Error('[default-dev-agent] no empty canvas point found')
    }

    await page.mouse.click(point.x, point.y, { button: 'right' })
    await page.screenshot({ path: path.join(artifactDir, 'context-menu.png'), fullPage: true })
    const launchMenu = await openAgentFromContextMenu(page)
    const previousNodeIds = new Set(
      before.dom.terminalNodes.map(node => node.nodeId).filter(Boolean),
    )
    const created = await waitForNewTerminalNode(page, previousNodeIds)
    const newNodeId = created.node.nodeId
    const runtimeSessionId = await waitForRuntimeSession(page, newNodeId)
    const expectedProvider = inferExpectedProvider({
      createdNodeTitle: created.node.title,
      defaultProvider: before.appState.defaultProvider,
    })
    const providerSnapshot = await waitForProviderScreen(page, runtimeSessionId, expectedProvider)
    const geometry = await readTerminalGeometry(page, newNodeId, runtimeSessionId)
    const after = {
      appState: await readDevState(page),
      dom: await readTerminalDomSnapshot(page),
      newNodeId,
      runtimeSessionId,
      providerSnapshot: {
        title: providerSnapshot.title ?? null,
        cols: providerSnapshot.cols ?? null,
        rows: providerSnapshot.rows ?? null,
        preview:
          typeof providerSnapshot.serializedScreen === 'string'
            ? providerSnapshot.serializedScreen.slice(0, 1_000)
            : null,
      },
      geometry,
    }

    if (
      geometry.terminalSize &&
      geometry.snapshotSize &&
      (geometry.terminalSize.cols !== geometry.snapshotSize.cols ||
        geometry.terminalSize.rows !== geometry.snapshotSize.rows)
    ) {
      throw new Error(`[default-dev-agent] terminal size mismatch: ${JSON.stringify(geometry)}`)
    }

    if (
      geometry.terminalSize &&
      geometry.proposedGeometry &&
      (geometry.terminalSize.cols !== geometry.proposedGeometry.cols ||
        geometry.terminalSize.rows !== geometry.proposedGeometry.rows)
    ) {
      throw new Error(
        `[default-dev-agent] terminal measured size mismatch: ${JSON.stringify(geometry)}`,
      )
    }

    if ((geometry.horizontalOverflowPx ?? 0) > 4 || (geometry.verticalOverflowPx ?? 0) > 4) {
      throw new Error(`[default-dev-agent] terminal overflow detected: ${JSON.stringify(geometry)}`)
    }

    const report = {
      ok: true,
      platform: process.platform,
      pnpmCommand,
      requestedProvider,
      launchMenu,
      userData,
      before,
      clickPoint: point,
      after,
    }
    await writeFile(path.join(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    await page.screenshot({ path: path.join(artifactDir, 'after-agent.png'), fullPage: true })
    process.stdout.write(`[default-dev-agent] passed; artifacts: ${artifactDir}\n`)
  } finally {
    await writeFile(path.join(artifactDir, 'electron.log'), logs.join(''), 'utf8').catch(
      () => undefined,
    )
    await browser?.close().catch(() => undefined)
    await killProcessTree(child.pid)
  }
}

await main()
