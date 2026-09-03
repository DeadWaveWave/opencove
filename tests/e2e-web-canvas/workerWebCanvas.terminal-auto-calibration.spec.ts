import { expect, test } from '@playwright/test'
import {
  buildAppState,
  createWorkspaceDir,
  invokeValue,
  openAuthedCanvas,
  readSharedState,
  writeAppState,
} from './helpers'

test('Web automatically calibrates a compatible shared terminal reference without remounting xterm', async ({
  page,
}) => {
  const workspacePath = await createWorkspaceDir('web-auto-calibration')
  await writeAppState(
    page.request,
    buildAppState({
      workspacePath,
      workspaceName: 'web-auto-calibration',
      spaces: [],
      settings: {
        terminalFontSize: 13,
        terminalFontFamily: null,
        terminalDisplayAutoReferenceEnabled: true,
        terminalDisplayCalibrationCompensationEnabled: false,
        terminalDisplayReference: null,
      },
    }),
  )
  await openAuthedCanvas(page)
  await page.goto('/?opencoveTerminalTestApi=1', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    window.localStorage.removeItem('opencove:terminal-display-calibration:v1')
    window.localStorage.removeItem('opencove:terminal-display-calibration-environment:v1')
    window.localStorage.removeItem('opencove:terminal-display-calibration-suppression:v1')
  })

  const pane = page.locator('.workspace-canvas .react-flow__pane')
  await pane.click({ button: 'right', position: { x: 260, y: 220 } })
  await page.locator('[data-testid="workspace-context-new-terminal"]').click()
  const terminal = page.locator('.terminal-node').first()
  await expect(terminal).toBeVisible()

  await expect
    .poll(
      async () => {
        const shared = await invokeValue<{
          state: { settings?: { terminalDisplayReference?: unknown } } | null
        }>(page.request, 'query', 'sync.state', null)
        return shared.state?.settings?.terminalDisplayReference ?? null
      },
      { timeout: 15_000 },
    )
    .not.toBeNull()
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem('opencove:terminal-display-calibration:v1'),
    ),
  ).toBeNull()

  const shared = await readSharedState(page.request)
  expect(
    (shared.state as { settings?: { terminalDisplayReference?: { capture?: unknown } } } | null)
      ?.settings?.terminalDisplayReference?.capture,
  ).toMatchObject({ algorithmVersion: 1, rendererKind: expect.stringMatching(/^(dom|webgl)$/) })
  const terminalNode = shared.state?.workspaces[0]?.nodes.find(node => node.kind === 'terminal')
  if (!terminalNode || typeof terminalNode.id !== 'string') {
    throw new Error('Missing Web terminal node')
  }
  const nodeId = terminalNode.id
  await terminal.locator('.xterm').click()
  await page.keyboard.type(
    `node -e "for(let i=0;i<40;i++)process.stdout.write((i===0?'WEB_CALIBRATION_HISTORY':'WEB_CALIBRATION_'+i)+'\\n')"`,
  )
  await page.keyboard.press('Enter')
  await expect(terminal).toContainText('WEB_CALIBRATION_39')
  await page.evaluate(id => {
    const element = document.querySelector('.terminal-node .xterm') as HTMLElement | null
    if (element) {
      element.dataset['calibrationIdentity'] = 'same-web-terminal'
    }
    window.__opencoveTerminalSelectionTestApi?.scrollToLine(id, 3)
  }, nodeId)
  const before = await page.evaluate(id => {
    const api = window.__opencoveTerminalSelectionTestApi
    const buffer = api?.getBufferText(id, 'WEB_CALIBRATION_HISTORY') ?? null
    return {
      timeOrigin: performance.timeOrigin,
      sessionId: api?.getRuntimeSessionId(id) ?? null,
      instanceId: api?.getRenderMetrics(id)?.instanceId ?? null,
      domToken:
        (document.querySelector('.terminal-node .xterm') as HTMLElement | null)?.dataset[
          'calibrationIdentity'
        ] ?? null,
      markerAbsoluteLine: buffer?.markerAbsoluteLine ?? null,
      viewportY: api?.getViewportY(id) ?? null,
    }
  }, nodeId)

  await page.locator('[data-testid="app-header-settings"]').click()
  await page.locator('[data-testid="settings-section-nav-appearance"]').click()
  const compensation = page.locator('[data-testid="settings-terminal-display-compensation"]')
  await expect(compensation).toHaveJSProperty('checked', false)
  await compensation.click()
  await expect(compensation).toHaveJSProperty('checked', true)

  let calibration: {
    fontSize: number
    lineHeight: number
    letterSpacing: number
    target: { cols: number; rows: number }
    measured?: { cols: number; rows: number }
  } | null = null
  await expect
    .poll(
      async () => {
        calibration = await page.evaluate(() => {
          const raw = window.localStorage.getItem('opencove:terminal-display-calibration:v1')
          return raw ? JSON.parse(raw) : null
        })
        return calibration
      },
      { timeout: 20_000 },
    )
    .not.toBeNull()
  await page.locator('[data-testid="settings-panel-close"]').click()
  await expect(terminal).toContainText('WEB_CALIBRATION_HISTORY')

  const after = await page.evaluate(id => {
    const api = window.__opencoveTerminalSelectionTestApi
    const buffer = api?.getBufferText(id, 'WEB_CALIBRATION_HISTORY') ?? null
    return {
      timeOrigin: performance.timeOrigin,
      sessionId: api?.getRuntimeSessionId(id) ?? null,
      instanceId: api?.getRenderMetrics(id)?.instanceId ?? null,
      domToken:
        (document.querySelector('.terminal-node .xterm') as HTMLElement | null)?.dataset[
          'calibrationIdentity'
        ] ?? null,
      markerAbsoluteLine: buffer?.markerAbsoluteLine ?? null,
      viewportY: api?.getViewportY(id) ?? null,
      fontOptions: api?.getFontOptions(id) ?? null,
      size: api?.getSize(id) ?? null,
    }
  }, nodeId)
  expect(after).toMatchObject({
    timeOrigin: before.timeOrigin,
    sessionId: before.sessionId,
    instanceId: before.instanceId,
    domToken: before.domToken,
    viewportY: before.viewportY,
    markerAbsoluteLine: expect.any(Number),
    fontOptions: {
      fontSize: calibration?.fontSize,
      lineHeight: calibration?.lineHeight,
      letterSpacing: calibration?.letterSpacing,
    },
    size: expect.any(Object),
  })
  expect(calibration?.measured).toMatchObject({
    cols: calibration?.target.cols,
    rows: calibration?.target.rows,
  })
  const snapshot = await page.evaluate(
    async sessionId =>
      sessionId ? await window.opencoveApi.pty.presentationSnapshot({ sessionId }) : null,
    after.sessionId,
  )
  expect(snapshot).toMatchObject({ cols: after.size?.cols, rows: after.size?.rows })
})

test('a fresh Web client applies a compatible reference without opening Settings', async ({
  browser,
  page,
}) => {
  const workspacePath = await createWorkspaceDir('web-no-click-auto-calibration')
  await writeAppState(
    page.request,
    buildAppState({
      workspacePath,
      workspaceName: 'web-no-click-auto-calibration',
      spaces: [],
      nodes: [
        {
          id: 'calibration-terminal',
          title: 'Calibration terminal',
          kind: 'terminal',
          position: { x: 120, y: 120 },
          width: 640,
          height: 400,
        },
      ],
      settings: {
        terminalFontSize: 13,
        terminalFontFamily: null,
        terminalDisplayAutoReferenceEnabled: true,
        terminalDisplayCalibrationCompensationEnabled: true,
        terminalDisplayReference: null,
      },
    }),
  )
  await openAuthedCanvas(page)
  await expect(page.locator('.terminal-node')).toBeVisible()
  await expect
    .poll(
      async () => {
        const shared = await invokeValue<{
          state: { settings?: { terminalDisplayReference?: unknown } } | null
        }>(page.request, 'query', 'sync.state', null)
        return shared.state?.settings?.terminalDisplayReference ?? null
      },
      { timeout: 20_000 },
    )
    .not.toBeNull()

  const shared = await invokeValue<{
    state: { settings?: { terminalDisplayReference?: unknown } } | null
  }>(page.request, 'query', 'sync.state', null)
  const seededReference = shared.state?.settings?.terminalDisplayReference
  if (!seededReference) {
    throw new Error('Missing compatible shared terminal reference')
  }

  const freshContext = await browser.newContext()
  await freshContext.addInitScript(referenceValue => {
    const reference = referenceValue as {
      measurement?: {
        cols?: number
        rows?: number
        cssCellWidth?: number
        cssCellHeight?: number
        effectiveDpr?: number
      }
    }
    const measurement = reference.measurement
    if (measurement) {
      window.localStorage.setItem(
        'opencove:terminal-display-calibration:v1',
        JSON.stringify({
          version: 1,
          profileKey: JSON.stringify({ fontSize: 13, fontFamily: null }),
          fontSize: 20,
          lineHeight: 1,
          letterSpacing: 0,
          target: {
            cols: measurement.cols,
            rows: measurement.rows,
            cssCellWidth: measurement.cssCellWidth,
            cssCellHeight: measurement.cssCellHeight,
            effectiveDpr: measurement.effectiveDpr,
          },
          measured: {
            cols: measurement.cols,
            rows: measurement.rows,
            cssCellWidth: measurement.cssCellWidth,
            cssCellHeight: measurement.cssCellHeight,
            effectiveDpr: measurement.effectiveDpr,
          },
          score: 0,
          measuredAt: '2026-09-01T00:00:00.000Z',
        }),
      )
      window.localStorage.removeItem('opencove:terminal-display-calibration-environment:v1')
    }

    const probe = {
      firstXterm: null as Element | null,
      detached: false,
      sawUnverifiedFont: false,
    }
    Object.defineProperty(window, '__opencoveCalibrationMountProbe', { value: probe })
    const observeRuntime = (): void => {
      const api = window.__opencoveTerminalSelectionTestApi
      const current = document.querySelector('.terminal-node .xterm')
      if (api?.getRuntimeSessionId('calibration-terminal')) {
        if (!probe.firstXterm && current) {
          probe.firstXterm = current
        } else if (probe.firstXterm && !probe.firstXterm.isConnected) {
          probe.detached = true
        }
        if (api.getFontOptions('calibration-terminal')?.fontSize === 20) {
          probe.sawUnverifiedFont = true
        }
      }
      window.requestAnimationFrame(observeRuntime)
    }
    window.requestAnimationFrame(observeRuntime)
  }, seededReference)
  const freshPage = await freshContext.newPage()
  try {
    await openAuthedCanvas(freshPage, '/?opencoveTerminalTestApi=1')
    await expect(freshPage.locator('.terminal-node')).toBeVisible()
    await expect
      .poll(
        async () =>
          await freshPage.evaluate(() => {
            const raw = window.localStorage.getItem('opencove:terminal-display-calibration:v1')
            if (!raw) {
              return null
            }
            const stored = JSON.parse(raw) as { verification?: { environmentSignature?: unknown } }
            return typeof stored.verification?.environmentSignature === 'string'
              ? stored.verification.environmentSignature
              : null
          }),
        { timeout: 20_000 },
      )
      .not.toBeNull()

    const storedCalibration = await freshPage.evaluate(() => {
      const raw = window.localStorage.getItem('opencove:terminal-display-calibration:v1')
      return raw
        ? (JSON.parse(raw) as {
            fontSize: number
            lineHeight: number
            letterSpacing: number
          })
        : null
    })
    expect(storedCalibration).not.toBeNull()
    await expect
      .poll(
        async () =>
          await freshPage.evaluate(() =>
            window.__opencoveTerminalSelectionTestApi?.getFontOptions('calibration-terminal'),
          ),
      )
      .toMatchObject({
        fontSize: storedCalibration?.fontSize,
        lineHeight: storedCalibration?.lineHeight,
        letterSpacing: storedCalibration?.letterSpacing,
      })

    expect(
      await freshPage.evaluate(() => {
        const probe = (
          window as unknown as {
            __opencoveCalibrationMountProbe?: {
              firstXterm: Element | null
              detached: boolean
              sawUnverifiedFont: boolean
            }
          }
        ).__opencoveCalibrationMountProbe
        return {
          captured: Boolean(probe?.firstXterm),
          detached: probe?.detached ?? false,
          connected: probe?.firstXterm?.isConnected ?? false,
          sawUnverifiedFont: probe?.sawUnverifiedFont ?? false,
        }
      }),
    ).toEqual({
      captured: true,
      detached: false,
      connected: true,
      sawUnverifiedFont: false,
    })
  } finally {
    await freshContext.close()
  }
})
