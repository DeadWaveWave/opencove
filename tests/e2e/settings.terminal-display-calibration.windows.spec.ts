import { expect, test, type Page } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

async function openAppearance(window: Page): Promise<void> {
  await window.getByTestId('app-header-settings').click()
  await window.getByTestId('settings-section-nav-appearance').click()
}

async function createSibling(window: Page): Promise<string> {
  const existing = await window
    .locator('.react-flow__node')
    .evaluateAll(nodes => nodes.map(node => node.getAttribute('data-id')))
  await window.getByTestId('settings-panel-close').click()
  await window.locator('.react-flow__pane').click({
    button: 'right',
    position: { x: 950, y: 500 },
  })
  await window.getByTestId('workspace-context-new-terminal').click()
  await expect(window.locator('.terminal-node')).toHaveCount(existing.length + 1)
  const id = await window
    .locator('.react-flow__node')
    .evaluateAll(
      (nodes, previous) =>
        nodes
          .map(node => node.getAttribute('data-id')!)
          .find(nodeId => !previous.includes(nodeId))!,
      existing,
    )
  await expect
    .poll(() =>
      window.evaluate(
        nodeId =>
          window.__opencoveTerminalSelectionTestApi?.getRenderMetrics(nodeId)
            ?.rendererStructuralKind,
        id,
      ),
    )
    .toMatch(/^(dom|webgl)$/)
  await openAppearance(window)
  return id
}

test('keeps calibration stable across Windows startup, resize and same-kind terminal mounts', async () => {
  test.skip(process.platform !== 'win32', 'Windows display calibration at 150% scale')
  const { electronApp, window } = await launchApp({ deviceScaleFactor: 1.5 })
  try {
    await clearAndSeedWorkspace(
      window,
      Array.from({ length: 2 }, (_, index) => ({
        id: `calibration-${index}`,
        title: `calibration-${index}`,
        position: { x: 180 + index * 40, y: 100 + index * 40 },
        width: 520,
        height: 340,
      })),
      {
        settings: {
          terminalFontSize: 13,
          terminalFontFamily: null,
          terminalDisplayAutoReferenceEnabled: true,
          terminalDisplayCalibrationCompensationEnabled: true,
        },
      },
    )
    await openAppearance(window)
    const summary = window.getByTestId('settings-terminal-display-summary')
    await expect(summary).toHaveAttribute(
      'data-calibration-state',
      /^(applied|already-calibrated)$/,
    )
    expect(await window.evaluate(() => window.devicePixelRatio)).toBe(1.5)

    // A restart must verify the persisted atomic record before applying it again.
    await window.reload({ waitUntil: 'domcontentloaded' })
    await openAppearance(window)
    await expect(summary).toHaveAttribute('data-calibration-state', 'already-calibrated')
    const before = await window.evaluate(() => ({
      sessionId: window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId('calibration-0'),
      instanceId:
        window.__opencoveTerminalSelectionTestApi?.getRenderMetrics('calibration-0')?.instanceId,
      font: window.__opencoveTerminalSelectionTestApi?.getFontOptions('calibration-0'),
      stored: localStorage.getItem('opencove:terminal-display-calibration:v1'),
    }))
    await window.evaluate(() => {
      const attribute = 'data-calibration-state'
      const states: string[] = []
      const observer = new MutationObserver(records => {
        for (const record of records) {
          if (record.oldValue) {
            states.push(record.oldValue)
          }
          const next = (record.target as Element).getAttribute(attribute)
          if (next) {
            states.push(next)
          }
        }
        document.documentElement.dataset.calibrationTransitions = JSON.stringify(states)
      })
      observer.observe(
        document.querySelector('[data-testid="settings-terminal-display-summary"]')!,
        {
          attributes: true,
          attributeFilter: [attribute],
          attributeOldValue: true,
        },
      )
      document.documentElement.dataset.calibrationTransitions = '[]'
    })
    await electronApp.evaluate(({ BrowserWindow }) => {
      const appWindow = BrowserWindow.getAllWindows()[0]!
      const [width, height] = appWindow.getContentSize()
      appWindow.setContentSize(width - 60, height - 40)
    })
    await window.evaluate(async () => {
      for (let index = 0; index < 12; index += 1) {
        window.dispatchEvent(new Event('resize'))
        window.visualViewport?.dispatchEvent(new Event('resize'))
        window.dispatchEvent(new StorageEvent('storage', { key: 'opencove:unrelated-setting' }))
        // Allow a render between notifications so flicker cannot hide in React batching.
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      }
    })
    expect(
      await window.evaluate(() =>
        JSON.parse(document.documentElement.dataset.calibrationTransitions!),
      ),
    ).toEqual([])
    const siblingId = await createSibling(window)
    await expect(summary).toHaveAttribute('data-calibration-state', 'already-calibrated')
    await window.locator(`[data-id="${siblingId}"] .terminal-node__close`).dispatchEvent('click')
    await expect(window.locator('.terminal-node')).toHaveCount(2)
    await expect(summary).toHaveAttribute('data-calibration-state', 'already-calibrated')
    expect(
      await window.evaluate(() => ({
        sessionId: window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId('calibration-0'),
        instanceId:
          window.__opencoveTerminalSelectionTestApi?.getRenderMetrics('calibration-0')?.instanceId,
        font: window.__opencoveTerminalSelectionTestApi?.getFontOptions('calibration-0'),
        stored: localStorage.getItem('opencove:terminal-display-calibration:v1'),
      })),
    ).toEqual(before)
    await test.info().attach('windows-calibration-active', {
      body: await summary.screenshot(),
      contentType: 'image/png',
    })

    // The ninth terminal exceeds the WebGL budget: this is a real environment
    // change and must explain its blocker without destroying the saved record.
    let lastSibling = ''
    for (let count = 2; count < 9; count += 1) {
      // eslint-disable-next-line no-await-in-loop
      lastSibling = await createSibling(window)
    }
    await expect(summary).toHaveAttribute('data-calibration-state', 'mixed-renderers')
    await expect(summary).toContainText('different display methods')
    expect(
      await window.evaluate(() => localStorage.getItem('opencove:terminal-display-calibration:v1')),
    ).toBe(before.stored)
    await test.info().attach('windows-calibration-mixed-renderers', {
      body: await summary.screenshot(),
      contentType: 'image/png',
    })
    await window.locator(`[data-id="${lastSibling}"] .terminal-node__close`).dispatchEvent('click')
    await expect(summary).toHaveAttribute('data-calibration-state', 'already-calibrated')
  } finally {
    await electronApp.close()
  }
})
