import { chromium, expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import {
  buildNodeEvalCommand,
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
} from './workspace-canvas.helpers'

const nodeId = 'terminal-worker-web-access-continuity'
const secondNodeId = 'terminal-worker-web-access-continuity-second'

async function writeCommand(page: Page, source: string, targetNodeId = nodeId): Promise<void> {
  const terminal = page.locator(`[data-id="${targetNodeId}"] .terminal-node`)
  await expect(terminal.locator('.terminal-node__terminal')).toHaveAttribute('aria-busy', 'false')
  await terminal.locator('.xterm-helper-textarea').focus()
  await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()
  await page.keyboard.type(buildNodeEvalCommand(source))
  await page.keyboard.press('Enter')
}

async function writeHistory(page: Page, targetNodeId: string): Promise<void> {
  await writeCommand(
    page,
    `for (let i = 0; i < 80; i += 1) process.stdout.write((i === 0 ? 'HISTORY_HEAD' : 'HISTORY_' + String(i).padStart(3, '0')) + '\\n')`,
    targetNodeId,
  )
  await expect(page.locator(`[data-id="${targetNodeId}"] .terminal-node`)).toContainText(
    'HISTORY_079',
    { timeout: 10_000 },
  )
}

async function expectCompleteSequence(
  page: Page,
  targetNodeId: string,
  prefix: string,
): Promise<void> {
  const sequencePositions = await page.evaluate(
    ({ id, sequencePrefix }) => {
      const api = window.__opencoveTerminalSelectionTestApi
      return Array.from(
        { length: 600 },
        (_, index) =>
          api?.getBufferText(id, `${sequencePrefix}${String(index).padStart(3, '0')}`)
            ?.markerAbsoluteLine ?? null,
      )
    },
    { id: targetNodeId, sequencePrefix: prefix },
  )
  expect(sequencePositions.every(position => position !== null)).toBe(true)
  expect(
    sequencePositions.every(
      (position, index) => index === 0 || Number(position) > Number(sequencePositions[index - 1]),
    ),
  ).toBe(true)
  await page.evaluate(id => {
    window.__opencoveTerminalSelectionTestApi?.scrollToBottom(id)
  }, targetNodeId)
  await expect(page.locator(`[data-id="${targetNodeId}"] .terminal-node`)).toContainText(
    `${prefix}599`,
    { timeout: 10_000 },
  )
}

async function reserveFreePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to reserve a Web access test port')
  }
  await new Promise<void>(resolvePromise => server.close(() => resolvePromise()))
  return address.port
}

async function openWebSettings(page: Page): Promise<void> {
  await page.locator('[data-testid="app-header-settings"]').click()
  await page.locator('[data-testid="settings-section-nav-worker"]').click()
}

async function closeWebSettings(page: Page): Promise<void> {
  await page.locator('[data-testid="settings-panel-close"]').click()
  await expect(page.locator('.settings-backdrop')).toHaveCount(0)
}

async function applyWebEnabled(page: Page, enabled: boolean): Promise<void> {
  await openWebSettings(page)
  const toggle = page.locator('[data-testid="settings-experimental-worker-web-ui-enabled"]')
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveJSProperty('checked', !enabled)
  await toggle.click()
  await expect(toggle).toHaveJSProperty('checked', enabled)
  await closeWebSettings(page)
  await expect(page.locator('.terminal-node')).toHaveCount(2)
}

async function applyWebPort(page: Page, port: number): Promise<void> {
  await openWebSettings(page)
  const input = page.locator('[data-testid="settings-experimental-worker-web-ui-port"]')
  await input.fill(String(port))
  await page.locator('[data-testid="settings-experimental-worker-web-ui-port-save"]').click()
  await expect
    .poll(
      async () =>
        await page.evaluate(async expectedPort => {
          return (await window.opencoveApi.workerClient.getConfig()).webUi.port === expectedPort
        }, port),
    )
    .toBe(true)
  await expect(input).toHaveValue(String(port))
  await closeWebSettings(page)
}

async function applyWebPassword(page: Page, password: string): Promise<void> {
  await openWebSettings(page)
  const input = page.locator('[data-testid="settings-experimental-worker-web-ui-password"]')
  await input.fill(password)
  await page.locator('[data-testid="settings-experimental-worker-web-ui-password-save"]').click()
  await expect(input).toHaveValue('')
  await closeWebSettings(page)
}

async function applyWebLan(page: Page, enabled: boolean): Promise<void> {
  await openWebSettings(page)
  const toggle = page.locator('[data-testid="settings-experimental-worker-web-ui-lan"]')
  await expect(toggle).toHaveJSProperty('checked', !enabled)
  await toggle.click()
  await expect(toggle).toHaveJSProperty('checked', enabled)
  await closeWebSettings(page)
}

async function readIdentity(
  page: Page,
  targetNodeId = nodeId,
): Promise<{
  workerPid: number | null
  workerCreatedAt: string | null
  rendererTimeOrigin: number
  sessionId: string | null
  xtermInstanceId: number | null
  xtermDomToken: string | null
  bufferLength: number | null
  markerAbsoluteLine: number | null
  viewportY: number | null
}> {
  return await page.evaluate(async id => {
    const status = await window.opencoveApi.worker.getStatus()
    const api = window.__opencoveTerminalSelectionTestApi
    const buffer = api?.getBufferText(id, 'HISTORY_HEAD') ?? null
    const xterm = document.querySelector(
      `.react-flow__node[data-id="${id}"] .terminal-node .xterm`,
    ) as HTMLElement | null
    return {
      workerPid: status.connection?.pid ?? null,
      workerCreatedAt: status.connection?.createdAt ?? null,
      rendererTimeOrigin: performance.timeOrigin,
      sessionId: api?.getRuntimeSessionId(id) ?? null,
      xtermInstanceId: api?.getRenderMetrics(id)?.instanceId ?? null,
      xtermDomToken: xterm?.dataset['continuityToken'] ?? null,
      bufferLength: buffer?.bufferLength ?? null,
      markerAbsoluteLine: buffer?.markerAbsoluteLine ?? null,
      viewportY: api?.getViewportY(id) ?? null,
    }
  }, targetNodeId)
}

test('Web access settings preserve Worker, PTY, Renderer, xterm, history, and viewport identity', async () => {
  const userDataDir = await createTestUserDataDir()
  await writeFile(
    join(userDataDir, 'home-worker.json'),
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
      updatedAt: null,
    })}\n`,
    'utf8',
  )
  const { electronApp, window } = await launchApp({ windowMode: 'offscreen', userDataDir })
  const browser = await chromium.launch({ headless: true })
  let mainFrameNavigations = 0
  window.on('framenavigated', frame => {
    if (frame === window.mainFrame()) {
      mainFrameNavigations += 1
    }
  })

  try {
    const currentConfig = await window.evaluate(async () => {
      const config = await window.opencoveApi.workerClient.getConfig()
      return await window.opencoveApi.workerClient.setWebUiSettings({
        enabled: false,
        port: config.webUi.port,
      })
    })
    expect(currentConfig.webUi.enabled).toBe(false)

    await clearAndSeedWorkspace(window, [
      {
        id: nodeId,
        title: nodeId,
        position: { x: 120, y: 120 },
        width: 680,
        height: 360,
      },
      {
        id: secondNodeId,
        title: secondNodeId,
        position: { x: 860, y: 120 },
        width: 680,
        height: 360,
      },
    ])
    await expect(window.locator('.terminal-node')).toHaveCount(2)
    await window.locator('.react-flow__controls-fitview').click()
    await writeHistory(window, nodeId)
    await writeHistory(window, secondNodeId)
    await writeCommand(
      window,
      `let i = 0; const timer = setInterval(() => { process.stdout.write('LIVE_A_' + String(i).padStart(3, '0') + '\\n'); i += 1; if (i === 600) clearInterval(timer) }, 15)`,
      nodeId,
    )
    await writeCommand(
      window,
      `let i = 0; const timer = setInterval(() => { process.stdout.write('LIVE_B_' + String(i).padStart(3, '0') + '\\n'); i += 1; if (i === 600) clearInterval(timer) }, 15)`,
      secondNodeId,
    )
    await expect(window.locator(`[data-id="${nodeId}"] .terminal-node`)).toContainText(
      'LIVE_A_000',
      { timeout: 10_000 },
    )
    await expect(window.locator(`[data-id="${secondNodeId}"] .terminal-node`)).toContainText(
      'LIVE_B_000',
      { timeout: 10_000 },
    )
    await window.evaluate(
      ids => {
        ids.forEach(id => {
          const xterm = document.querySelector(
            `.react-flow__node[data-id="${id}"] .terminal-node .xterm`,
          ) as HTMLElement | null
          if (xterm) {
            xterm.dataset['continuityToken'] = `same-xterm-dom-${id}`
          }
          window.__opencoveTerminalSelectionTestApi?.scrollToLine(id, 8)
        })
      },
      [nodeId, secondNodeId],
    )

    const before = await Promise.all([
      readIdentity(window, nodeId),
      readIdentity(window, secondNodeId),
    ])
    before.forEach(identity => {
      expect(identity.workerPid).toBeTruthy()
      expect(identity.sessionId).toBeTruthy()
      expect(identity.xtermInstanceId).toBeTruthy()
      expect(identity.markerAbsoluteLine).not.toBeNull()
    })
    const navigationBaseline = mainFrameNavigations

    const requestedPort = await reserveFreePort()
    await applyWebEnabled(window, true)
    await applyWebPort(window, requestedPort)
    const occupiedServer = createServer()
    await new Promise<void>((resolvePromise, rejectPromise) => {
      occupiedServer.once('error', rejectPromise)
      occupiedServer.listen(0, '127.0.0.1', resolvePromise)
    })
    const occupiedAddress = occupiedServer.address()
    if (!occupiedAddress || typeof occupiedAddress === 'string') {
      throw new Error('Failed to occupy rollback test port')
    }
    try {
      await openWebSettings(window)
      const portInput = window.locator('[data-testid="settings-experimental-worker-web-ui-port"]')
      await portInput.fill(String(occupiedAddress.port))
      await window.locator('[data-testid="settings-experimental-worker-web-ui-port-save"]').click()
      await expect(window.getByText('Error', { exact: true })).toBeVisible()
      await expect(
        window.getByText('Web access could not be updated. The previous listener remains active.'),
      ).toBeVisible()
      await expect
        .poll(
          async () =>
            await window.evaluate(
              async expectedPort =>
                (await window.opencoveApi.workerClient.getConfig()).webUi.port === expectedPort,
              requestedPort,
            ),
        )
        .toBe(true)
      await closeWebSettings(window)
    } finally {
      await new Promise<void>(resolvePromise => occupiedServer.close(() => resolvePromise()))
    }

    const portUrl = await window.evaluate(async () => await window.opencoveApi.worker.getWebUiUrl())
    expect(new URL(portUrl!).port).toBe(String(requestedPort))
    const web = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await web.goto(portUrl!, { waitUntil: 'domcontentloaded' })
    await web.goto(new URL('/?opencoveTerminalTestApi=1', portUrl!).toString(), {
      waitUntil: 'domcontentloaded',
    })
    await expect(web.locator('.terminal-node')).toHaveCount(2, { timeout: 30_000 })
    await Promise.all(
      [nodeId, secondNodeId].map(async (targetNodeId, index) => {
        await expect
          .poll(
            async () =>
              await web.evaluate(id => {
                const api = window.__opencoveTerminalSelectionTestApi
                return {
                  sessionId: api?.getRuntimeSessionId(id) ?? null,
                  historyLine: api?.getBufferText(id, 'HISTORY_HEAD')?.markerAbsoluteLine ?? null,
                }
              }, targetNodeId),
          )
          .toEqual({ sessionId: before[index].sessionId, historyLine: expect.any(Number) })
      }),
    )

    await applyWebPassword(window, 'first-test-password')
    await applyWebLan(window, true)
    await expect
      .poll(
        async () =>
          await web.evaluate(async () => {
            try {
              await window.opencoveApi.controlSurface.invoke({
                kind: 'query',
                id: 'system.ping',
                payload: null,
              })
              return true
            } catch {
              return false
            }
          }),
      )
      .toBe(false)
    await applyWebPassword(window, 'second-test-password')
    await applyWebLan(window, false)

    const refreshedUrl = await window.evaluate(
      async () => await window.opencoveApi.worker.getWebUiUrl(),
    )
    const reauthenticatedWeb = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await reauthenticatedWeb.goto(refreshedUrl!, { waitUntil: 'domcontentloaded' })
    await reauthenticatedWeb.goto(
      new URL('/?opencoveTerminalTestApi=1', refreshedUrl!).toString(),
      { waitUntil: 'domcontentloaded' },
    )
    await expect(reauthenticatedWeb.locator('.terminal-node')).toHaveCount(2, {
      timeout: 30_000,
    })
    await applyWebEnabled(window, false)
    await Promise.all(
      [
        { id: nodeId, marker: 'LIVE_A_599' },
        { id: secondNodeId, marker: 'LIVE_B_599' },
      ].map(async target => {
        await expect
          .poll(
            async () =>
              await window.evaluate(
                ({ id, marker }) =>
                  window.__opencoveTerminalSelectionTestApi?.getBufferText(id, marker)
                    ?.markerAbsoluteLine ?? null,
                target,
              ),
            { timeout: 15_000 },
          )
          .not.toBeNull()
      }),
    )

    const after = await Promise.all([
      readIdentity(window, nodeId),
      readIdentity(window, secondNodeId),
    ])
    after.forEach((identity, index) => {
      expect(identity).toEqual({
        ...before[index],
        bufferLength: expect.any(Number),
      })
      expect(identity.bufferLength).toBeGreaterThanOrEqual(before[index].bufferLength ?? 0)
    })
    expect(mainFrameNavigations).toBe(navigationBaseline)
    await Promise.all([
      expectCompleteSequence(window, nodeId, 'LIVE_A_'),
      expectCompleteSequence(window, secondNodeId, 'LIVE_B_'),
    ])

    const marker = `AFTER_APPLY_${Date.now()}`
    await writeCommand(window, `process.stdout.write('${marker}_A\\n')`, nodeId)
    await writeCommand(window, `process.stdout.write('${marker}_B\\n')`, secondNodeId)
    await expect(window.locator(`[data-id="${nodeId}"] .terminal-node`)).toContainText(
      `${marker}_A`,
    )
    await expect(window.locator(`[data-id="${secondNodeId}"] .terminal-node`)).toContainText(
      `${marker}_B`,
    )
  } finally {
    await browser.close()
    await electronApp.close()
  }
})
