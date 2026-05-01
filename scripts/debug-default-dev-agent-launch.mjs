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
const providerMarker = /OpenAI\s+Codex|Codex|Claude\s+Code|Gemini|opencode/i
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

async function waitForAgentOutput(page, previousTerminalCount) {
  const deadline = Date.now() + 60_000
  let latest = null

  while (Date.now() < deadline) {
    latest = await page.evaluate(() => ({
      terminalCount: document.querySelectorAll('.terminal-node').length,
      bodyText: document.body.innerText,
      workerText: document.body.innerText.slice(0, 2_000),
    }))

    if (latest.terminalCount > previousTerminalCount && providerMarker.test(latest.bodyText)) {
      return latest
    }

    await delay(500)
  }

  throw new Error(
    `[default-dev-agent] agent output did not appear: ${JSON.stringify(latest?.workerText)}`,
  )
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
  const userData = await backupDefaultDevUserData(artifactDir)
  const logs = []
  const env = {
    ...process.env,
    OPENCOVE_TERMINAL_DIAGNOSTICS: '1',
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

    const before = await page.evaluate(async () => ({
      worker: await window.opencoveApi.worker.getStatus().catch(error => ({
        error: error instanceof Error ? error.message : String(error),
      })),
      availability: (
        await window.opencoveApi.agent.listInstalledProviders({}).catch(error => ({
          error: error instanceof Error ? error.message : String(error),
        }))
      ).availabilityByProvider?.codex,
      terminalCount: document.querySelectorAll('.terminal-node').length,
      bodyPreview: document.body.innerText.slice(0, 2_000),
    }))

    const point = await findEmptyCanvasPoint(page)
    if (!point) {
      throw new Error('[default-dev-agent] no empty canvas point found')
    }

    await page.mouse.click(point.x, point.y, { button: 'right' })
    await page.screenshot({ path: path.join(artifactDir, 'context-menu.png'), fullPage: true })
    await page.locator('[data-testid="workspace-context-run-default-agent"]').click({
      timeout: 15_000,
    })

    const output = await waitForAgentOutput(page, before.terminalCount)
    const report = {
      ok: true,
      platform: process.platform,
      pnpmCommand,
      userData,
      before,
      clickPoint: point,
      after: {
        terminalCount: output.terminalCount,
        bodyPreview: output.bodyText.slice(0, 4_000),
      },
    }
    await writeFile(path.join(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
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
