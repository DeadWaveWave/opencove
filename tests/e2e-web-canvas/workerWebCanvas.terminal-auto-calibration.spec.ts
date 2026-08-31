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
    ...before,
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
