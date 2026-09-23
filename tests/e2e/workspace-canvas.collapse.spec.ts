/* eslint-disable no-await-in-loop -- Real pointer actions intentionally run in sequence. */
import { expect, test, type Page } from '@playwright/test'
import { buildNodeEvalCommand, launchApp, selectCoveOption } from './workspace-canvas.helpers'
import {
  createMaterialFixture,
  seedMaterialFixture,
  MATERIAL_NODE_KINDS,
  MATERIAL_TERMINAL,
} from './workspace-canvas.spatial-pixel.materials.fixture'
import { openPixelAppearance } from './workspace-canvas.pixel-effects.helpers'

async function identity(page: Page) {
  return page.evaluate(id => {
    const api = window.__opencoveTerminalSelectionTestApi
    const element = document.querySelector(
      `[data-id="${id}"] .terminal-node__terminal`,
    ) as HTMLElement
    return {
      sessionId: api?.getRuntimeSessionId(id),
      instanceId: api?.getRenderMetrics(id)?.instanceId,
      size: api?.getSize(id),
      body: { width: element.clientWidth, height: element.clientHeight },
    }
  }, MATERIAL_TERMINAL)
}

test('collapses all window kinds without remounting editors or resizing a live PTY, and restores Space layouts', async ({
  browserName,
}, testInfo) => {
  void browserName
  const fixture = await createMaterialFixture()
  const { electronApp, window } = await launchApp()
  try {
    await seedMaterialFixture(window, fixture)
    await window.locator('.react-flow__controls-fitview').click()
    const original = await identity(window)
    expect(original.sessionId).toBeTruthy()
    const terminals = window.locator('.react-flow__node .terminal-node__terminal')
    const count = await terminals.count()
    // An expando verifies the same DOM/editor object survives disclosure.
    await window
      .locator('.document-node .monaco-editor')
      .evaluate(element => element.setAttribute('data-collapse-identity', 'kept'))
    for (const kind of MATERIAL_NODE_KINDS) {
      const node = window.locator(`[data-id="pixel-material-${kind}"]`)
      await node.getByTestId('node-collapse').click()
      await expect(window.getByTestId(`collapsed-node-pixel-material-${kind}`)).toBeVisible()
      await expect
        .poll(
          () =>
            node.evaluate(element => ({
              width: (element as HTMLElement).offsetWidth,
              height: (element as HTMLElement).offsetHeight,
            })),
          { message: `${kind} display frame settles to its compact dimensions` },
        )
        .toEqual({ width: 112, height: 96 })
    }
    expect(await terminals.count()).toBe(count)
    expect(await identity(window)).toEqual(original)
    const compactTerminal = window.getByTestId(`collapsed-node-${MATERIAL_TERMINAL}`)
    const terminalNode = window.locator(`[data-id="${MATERIAL_TERMINAL}"]`)
    await compactTerminal.getByTestId('node-expand').click({ modifiers: ['Shift'] })
    await expect(compactTerminal).toBeVisible()
    await expect(terminalNode).toHaveClass(/selected/)
    await compactTerminal.getByTestId('node-expand').click({ modifiers: ['Shift'] })
    await expect(terminalNode).not.toHaveClass(/selected/)
    await compactTerminal.getByTestId('node-expand').click()
    await expect(compactTerminal).toBeHidden()
    expect(await identity(window)).toEqual(original)
    await window.locator(`[data-id="${MATERIAL_TERMINAL}"]`).getByTestId('node-collapse').click()
    const sessionId = original.sessionId!
    await window.evaluate(
      async ({ id, command }) => {
        await window.opencoveApi.pty.write({ sessionId: id, data: `${command}\r` })
      },
      {
        id: sessionId,
        command: buildNodeEvalCommand(
          "process.stdout.write(['COLLAPSED', 'SESSION', 'CONTINUES'].join('_') + '\\n')",
        ),
      },
    )
    await expect(compactTerminal.locator('.cove-collapsed-window__icon')).toHaveAttribute(
      'data-output-active',
      'true',
    )
    await expect
      .poll(() =>
        window.evaluate(
          async id =>
            (await window.opencoveApi.pty.presentationSnapshot({ sessionId: id })).serializedScreen,
          sessionId,
        ),
      )
      .toContain('COLLAPSED_SESSION_CONTINUES')
    expect(
      await window.evaluate(async id => {
        const snapshot = await window.opencoveApi.pty.presentationSnapshot({ sessionId: id })
        return { cols: snapshot.cols, rows: snapshot.rows }
      }, sessionId),
    ).toEqual(original.size)
    await testInfo.attach('all-window-icons-pixel', {
      body: await window.screenshot(),
      contentType: 'image/png',
    })

    await window.getByTestId('workspace-space-collapse-arrange-pixel-build-space').click()
    await window.getByTestId('workspace-space-collapse-arrange-pixel-review-space').click()
    await window.locator('.react-flow__controls-fitview').click()
    for (const kind of MATERIAL_NODE_KINDS) {
      await expect(window.getByTestId(`collapsed-node-pixel-material-${kind}`)).toBeInViewport()
    }
    await expect(window.locator('[data-testid^="workspace-space-summary-"]')).toHaveCount(0)
    await expect(
      window.getByTestId('workspace-space-worktree-branch-pixel-review-space'),
    ).toBeVisible()
    await testInfo.attach('space-compact-windows', {
      body: await window.screenshot(),
      contentType: 'image/png',
    })
    await expect(compactTerminal).toBeVisible()
    expect(await identity(window)).toEqual(original)
    await compactTerminal.getByTestId('node-expand').click()
    await expect(compactTerminal).toBeHidden()
    await expect(
      window.locator(`[data-id="${MATERIAL_TERMINAL}"] .terminal-node__terminal`),
    ).toBeVisible()
    await expect(window.getByTestId('collapsed-node-pixel-material-agent')).toBeVisible()
    await expect(window.locator('.document-node .monaco-editor')).toHaveAttribute(
      'data-collapse-identity',
      'kept',
    )
    expect(await identity(window)).toEqual(original)

    await window.locator('.react-flow__controls-fitview').click()
    await expect.poll(() => terminalNode.evaluate(element => element.clientWidth)).toBe(420)
    const readNodePositions = () =>
      window.locator('.react-flow__node').evaluateAll(elements =>
        elements.map(element => ({
          id: element.getAttribute('data-id'),
          transform: (element as HTMLElement).style.transform,
        })),
      )
    const before = await readNodePositions()
    await window.getByTestId('workspace-space-collapse-arrange-pixel-build-space').click()
    await expect(compactTerminal).toBeVisible()
    await expect.poll(() => terminalNode.evaluate(element => element.clientWidth)).toBe(112)
    await expect(window.getByTestId('workspace-space-collapse-pixel-build-space')).toHaveCount(0)
    await expect(window.getByTestId('workspace-space-undo-arrange-pixel-build-space')).toHaveCount(
      0,
    )
    await testInfo.attach('collapsed-windows-arranged', {
      body: await window.screenshot(),
      contentType: 'image/png',
    })
    await window.getByTestId('workspace-space-menu-pixel-build-space').click()
    await window.getByTestId('workspace-space-undo-arrange-pixel-build-space').click()
    await expect.poll(readNodePositions).toEqual(before)
    await expect(
      window.locator(`[data-id="${MATERIAL_TERMINAL}"] .terminal-node__terminal`),
    ).toBeVisible()

    await openPixelAppearance(window)
    await selectCoveOption(window, 'settings-ui-theme', 'pixel-light')
    await window.locator('.settings-panel__close').click()
    await testInfo.attach('collapse-pixel-light', {
      body: await window.screenshot(),
      contentType: 'image/png',
    })
    await window.reload({ waitUntil: 'domcontentloaded' })
    await expect(window.getByTestId('collapsed-node-pixel-material-agent')).toBeVisible()
    await expect(window.getByTestId('collapsed-node-pixel-material-document')).toBeVisible()
  } finally {
    await electronApp.close()
    await fixture.cleanup()
  }
})
