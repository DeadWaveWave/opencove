import { chromium, expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  buildNodeEvalCommand,
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
} from './workspace-canvas.helpers'

const nodeId = 'terminal-desktop-web-consistency'

async function writeMarker(page: Page, marker: string): Promise<void> {
  const terminal = page.locator('.terminal-node').first()
  await expect(terminal.locator('.terminal-node__terminal')).toHaveAttribute('aria-busy', 'false')
  await terminal.locator('.xterm').click()
  await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()
  await page.keyboard.type(
    buildNodeEvalCommand(`process.stdout.write(${JSON.stringify(marker)} + '\\n')`),
  )
  await page.keyboard.press('Enter')
}

async function readGrid(page: Page): Promise<{ cols: number; rows: number } | null> {
  return await page.evaluate(
    id => window.__opencoveTerminalSelectionTestApi?.getSize(id) ?? null,
    nodeId,
  )
}

async function readRendererKind(page: Page): Promise<'dom' | 'webgl' | null> {
  return await page.evaluate(id => {
    const kind =
      window.__opencoveTerminalSelectionTestApi?.getRenderMetrics(id)?.rendererStructuralKind
    return kind === 'dom' || kind === 'webgl' ? kind : null
  }, nodeId)
}

async function readStoredCalibration(page: Page): Promise<string | null> {
  return await page.evaluate(() =>
    window.localStorage.getItem('opencove:terminal-display-calibration:v1'),
  )
}

async function hasAppliedAutomaticCalibration(page: Page): Promise<boolean> {
  return await page.evaluate(id => {
    const raw = window.localStorage.getItem('opencove:terminal-display-calibration:v1')
    if (!raw) {
      return false
    }
    const calibration = JSON.parse(raw) as {
      fontSize?: number
      lineHeight?: number
      letterSpacing?: number
      target?: { cols?: number; rows?: number }
      measured?: { cols?: number; rows?: number }
    }
    const applied = window.__opencoveTerminalSelectionTestApi?.getFontOptions(id) ?? null
    return Boolean(
      calibration.target?.cols === calibration.measured?.cols &&
      calibration.target?.rows === calibration.measured?.rows &&
      applied?.fontSize === calibration.fontSize &&
      applied.lineHeight === calibration.lineHeight &&
      applied.letterSpacing === calibration.letterSpacing,
    )
  }, nodeId)
}

test('Desktop and Web share one canonical PTY grid while both remain interactive', async () => {
  const userDataDir = await createTestUserDataDir()
  await writeFile(
    join(userDataDir, 'home-worker.json'),
    `${JSON.stringify({
      version: 1,
      mode: 'local',
      remote: null,
      webUi: { enabled: true, port: null, exposeOnLan: false, passwordHash: null },
      updatedAt: null,
    })}\n`,
    'utf8',
  )

  const { electronApp, window: desktop } = await launchApp({
    windowMode: 'offscreen',
    userDataDir,
  })
  const browser = await chromium.launch({ headless: true })
  try {
    await clearAndSeedWorkspace(desktop, [
      {
        id: nodeId,
        title: nodeId,
        position: { x: 120, y: 120 },
        width: 680,
        height: 360,
      },
    ])
    await expect(desktop.locator('.terminal-node')).toHaveCount(1)
    const worker = await desktop.evaluate(async () => await window.opencoveApi.worker.getStatus())
    const webUiUrl = await desktop.evaluate(
      async () => await window.opencoveApi.worker.getWebUiUrl(),
    )
    expect(worker.status).toBe('running')
    expect(webUiUrl).toBeTruthy()
    expect(new URL(webUiUrl!).port).not.toBe(String(worker.connection?.port))

    const web = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await web.goto(webUiUrl!, { waitUntil: 'domcontentloaded' })
    await web.goto(new URL('/?opencoveTerminalTestApi=1', webUiUrl!).toString(), {
      waitUntil: 'domcontentloaded',
    })
    await expect(web.locator('.terminal-node')).toHaveCount(1, { timeout: 30_000 })
    await expect(web.locator('.terminal-node .terminal-node__terminal')).toHaveAttribute(
      'aria-busy',
      'false',
      { timeout: 30_000 },
    )
    await expect.poll(async () => await hasAppliedAutomaticCalibration(desktop)).toBe(true)
    await expect.poll(async () => await readRendererKind(desktop)).not.toBeNull()
    await expect.poll(async () => await readRendererKind(web)).not.toBeNull()
    const desktopRendererKind = await readRendererKind(desktop)
    const webRendererKind = await readRendererKind(web)
    const renderersAreCompatible = desktopRendererKind === webRendererKind
    if (renderersAreCompatible) {
      await expect
        .poll(async () => await hasAppliedAutomaticCalibration(web), { timeout: 30_000 })
        .toBe(true)
    } else {
      // Renderer provenance is part of calibration proof. A DOM client must keep defaults when
      // the Desktop reference was captured from WebGL (and vice versa), while sharing PTY geometry.
      expect(await readStoredCalibration(web)).toBeNull()
    }

    const desktopSessionId = await desktop.evaluate(
      id => window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(id) ?? null,
      nodeId,
    )
    const webSessionId = await web.evaluate(
      id => window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(id) ?? null,
      nodeId,
    )
    expect(desktopSessionId).toBeTruthy()
    expect(webSessionId).toBe(desktopSessionId)

    await desktop.waitForTimeout(3_000)
    const canonicalSnapshot = await desktop.evaluate(
      async sessionId => await window.opencoveApi.pty.presentationSnapshot({ sessionId }),
      desktopSessionId!,
    )
    const canonicalGrid = await readGrid(desktop)
    const webGrid = await readGrid(web)
    const desktopProposal = await desktop.evaluate(
      id => window.__opencoveTerminalSelectionTestApi?.getProposedGeometry(id) ?? null,
      nodeId,
    )
    const webProposal = await web.evaluate(
      id => window.__opencoveTerminalSelectionTestApi?.getProposedGeometry(id) ?? null,
      nodeId,
    )
    expect(canonicalGrid).toEqual({ cols: canonicalSnapshot.cols, rows: canonicalSnapshot.rows })
    expect(webGrid).toEqual(canonicalGrid)
    expect(desktopProposal).toEqual(canonicalGrid)
    expect(webProposal).not.toBeNull()

    const identities = await Promise.all(
      [desktop, web].map(
        async page =>
          await page.evaluate(id => {
            const element = document.querySelector('.terminal-node .xterm') as HTMLElement | null
            if (element) {
              element.dataset['multiClientIdentity'] = 'same-xterm'
            }
            return {
              timeOrigin: performance.timeOrigin,
              instanceId:
                window.__opencoveTerminalSelectionTestApi?.getRenderMetrics(id)?.instanceId ?? null,
            }
          }, nodeId),
      ),
    )

    const webMarker = `WEB_INPUT_${Date.now()}`
    await writeMarker(web, webMarker)
    await expect(desktop.locator('.terminal-node')).toContainText(webMarker, { timeout: 10_000 })
    await expect(web.locator('.terminal-node')).toContainText(webMarker, { timeout: 10_000 })
    const desktopMarker = `DESKTOP_INPUT_${Date.now()}`
    await writeMarker(desktop, desktopMarker)
    await expect(desktop.locator('.terminal-node')).toContainText(desktopMarker, {
      timeout: 10_000,
    })
    await expect(web.locator('.terminal-node')).toContainText(desktopMarker, { timeout: 10_000 })
    expect(await readGrid(desktop)).toEqual(canonicalGrid)
    expect(await readGrid(web)).toEqual(canonicalGrid)

    const identitiesAfter = await Promise.all(
      [desktop, web].map(
        async page =>
          await page.evaluate(
            id => ({
              timeOrigin: performance.timeOrigin,
              instanceId:
                window.__opencoveTerminalSelectionTestApi?.getRenderMetrics(id)?.instanceId ?? null,
              domToken:
                (document.querySelector('.terminal-node .xterm') as HTMLElement | null)?.dataset[
                  'multiClientIdentity'
                ] ?? null,
            }),
            nodeId,
          ),
      ),
    )
    expect(identitiesAfter).toEqual(
      identities.map(identity => ({ ...identity, domToken: 'same-xterm' })),
    )

    if (await desktop.evaluate(() => window.opencoveApi.meta.platform !== 'win32')) {
      const marker = `STTY_${Date.now()}`
      await desktop.locator('.terminal-node .xterm').click()
      await desktop.keyboard.type(`printf '${marker} '; stty size`)
      await desktop.keyboard.press('Enter')
      await expect(desktop.locator('.terminal-node')).toContainText(
        `${marker} ${canonicalGrid?.rows} ${canonicalGrid?.cols}`,
        { timeout: 10_000 },
      )
      await expect(web.locator('.terminal-node')).toContainText(
        `${marker} ${canonicalGrid?.rows} ${canonicalGrid?.cols}`,
        { timeout: 10_000 },
      )
    }

    const desktopIdentityBeforeSecurity = await desktop.evaluate(
      async id => ({
        worker: await window.opencoveApi.worker.getStatus(),
        timeOrigin: performance.timeOrigin,
        instanceId:
          window.__opencoveTerminalSelectionTestApi?.getRenderMetrics(id)?.instanceId ?? null,
        sessionId: window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(id) ?? null,
      }),
      nodeId,
    )
    await desktop.evaluate(async () => {
      await window.opencoveApi.workerClient.setWebUiSecurity({
        exposeOnLan: false,
        password: 'multi-client-password',
      })
      await window.opencoveApi.workerClient.setWebUiSecurity({
        exposeOnLan: true,
        password: null,
      })
    })
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
        { timeout: 10_000 },
      )
      .toBe(false)

    const securityMarker = `DESKTOP_AFTER_SECURITY_${Date.now()}`
    await writeMarker(desktop, securityMarker)
    await expect(desktop.locator('.terminal-node')).toContainText(securityMarker)
    await desktop.evaluate(async () => {
      await window.opencoveApi.workerClient.setWebUiSecurity({
        exposeOnLan: false,
        password: null,
      })
    })
    const refreshedWebUrl = await desktop.evaluate(
      async () => await window.opencoveApi.worker.getWebUiUrl(),
    )
    expect(refreshedWebUrl).toBeTruthy()
    const reauthenticatedWeb = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await reauthenticatedWeb.goto(refreshedWebUrl!, { waitUntil: 'domcontentloaded' })
    await reauthenticatedWeb.goto(
      new URL('/?opencoveTerminalTestApi=1', refreshedWebUrl!).toString(),
      { waitUntil: 'domcontentloaded' },
    )
    await expect(reauthenticatedWeb.locator('.terminal-node')).toContainText(securityMarker, {
      timeout: 30_000,
    })
    expect(
      await reauthenticatedWeb.evaluate(
        id => window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(id) ?? null,
        nodeId,
      ),
    ).toBe(desktopSessionId)
    const reauthenticatedMarker = `WEB_REAUTHENTICATED_${Date.now()}`
    await writeMarker(reauthenticatedWeb, reauthenticatedMarker)
    await expect(desktop.locator('.terminal-node')).toContainText(reauthenticatedMarker, {
      timeout: 10_000,
    })

    const desktopIdentityAfterSecurity = await desktop.evaluate(
      async id => ({
        worker: await window.opencoveApi.worker.getStatus(),
        timeOrigin: performance.timeOrigin,
        instanceId:
          window.__opencoveTerminalSelectionTestApi?.getRenderMetrics(id)?.instanceId ?? null,
        sessionId: window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(id) ?? null,
      }),
      nodeId,
    )
    expect(desktopIdentityAfterSecurity).toEqual(desktopIdentityBeforeSecurity)
    if (!renderersAreCompatible) {
      expect(await readStoredCalibration(web)).toBeNull()
    }
  } finally {
    await browser.close()
    await electronApp.close()
  }
})
