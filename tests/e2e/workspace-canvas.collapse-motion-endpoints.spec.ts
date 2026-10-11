/* eslint-disable no-await-in-loop -- Disclosure endpoints are sampled sequentially. */
import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { toFileUri } from '../../src/contexts/filesystem/domain/fileUri'
import { rejectDocumentWrites } from './workspace-canvas.document-save.helpers'
import { launchApp, seedWorkspaceState } from './workspace-canvas.helpers'
import { EXPANSION_TERMINAL } from './workspace-canvas.collapse-expansion.helpers'
import { terminalSelector } from './workspace-canvas.collapse-motion.helpers'
import { createMaterialFixture } from './workspace-canvas.spatial-pixel.materials.fixture'
import {
  expectIdentityEndpointContinuous,
  finishCollapseAnimations,
  pauseCollapseAnimations,
  readIdentityFrame,
  seedIdentityEndpointFixture,
  seekCollapseEndpoint,
} from './workspace-canvas.collapse-motion-endpoints.helpers'

const cases = [
  { kind: 'terminal', title: 'Shell', fontScale: 1 },
  {
    kind: 'terminal',
    title: 'Workspace terminal with a deliberately long descriptive title',
    fontScale: 1.5,
  },
  { kind: 'agent', title: 'Review', fontScale: 1 },
  {
    kind: 'agent',
    title: 'Review every workspace change and explain the implementation details',
    fontScale: 1.5,
  },
] as const

for (const { kind, title, fontScale } of cases) {
  test(`${kind} disclosure keeps painted identity continuous at both endpoints: ${title}`, async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp()
    try {
      await seedIdentityEndpointFixture(window, kind, fontScale)
      const node = window.locator(terminalSelector)
      if (kind === 'agent') {
        await expect(node.getByTestId('terminal-node-title-display')).toHaveText('Review')
        await expect(node.locator('.cove-node-provider-icon')).toBeVisible()
      }
      await node.getByTestId('terminal-node-title-display').click()
      await node.getByTestId('terminal-node-inline-title-input').fill(title)
      await node.getByTestId('terminal-node-inline-title-input').press('Enter')
      await expect(node.getByTestId('terminal-node-title-display')).toHaveText(title)

      // Round-trip selection too: the final collapse starts from a selected
      // expanded node and must not paint its compact caption prematurely.
      for (const [step, direction] of (['collapse', 'expand', 'collapse'] as const).entries()) {
        if (direction === 'expand') {
          await node.getByTestId('node-expand').click({ modifiers: ['Shift'] })
          await expect(node).toHaveClass(/selected/)
        }
        const before = await readIdentityFrame(
          window,
          EXPANSION_TERMINAL,
          direction === 'collapse' ? 'header' : 'compact',
        )
        await pauseCollapseAnimations(window, EXPANSION_TERMINAL)
        if (step === 2) {
          // Selection mode owns pointer/keyboard routing. Invoke the shared
          // disclosure action without clearing selection, as Space folding does.
          await node.getByTestId('node-collapse').dispatchEvent('click')
        } else {
          await node.getByTestId(direction === 'collapse' ? 'node-collapse' : 'node-expand').click()
        }
        const firstAnimated = await readIdentityFrame(window, EXPANSION_TERMINAL, 'compact')
        await testInfo.attach(`${direction}-identity-start`, {
          body: JSON.stringify({ before, firstAnimated }, null, 2),
          contentType: 'application/json',
        })
        expectIdentityEndpointContinuous(before, firstAnimated)
        await seekCollapseEndpoint(window)
        const lastAnimated = await readIdentityFrame(window, EXPANSION_TERMINAL, 'compact')
        await testInfo.attach(`${direction}-last-animated-frame`, {
          body: await window.screenshot(),
          contentType: 'image/png',
        })
        await finishCollapseAnimations(window, EXPANSION_TERMINAL)
        const settled = await readIdentityFrame(
          window,
          EXPANSION_TERMINAL,
          direction === 'collapse' ? 'compact' : 'header',
        )
        await testInfo.attach(`${direction}-identity-handoff`, {
          body: JSON.stringify({ lastAnimated, settled }, null, 2),
          contentType: 'application/json',
        })
        expectIdentityEndpointContinuous(lastAnimated, settled)
        if (kind === 'agent' && direction === 'collapse') {
          await expect(node.locator('.cove-collapsed-window__title')).toHaveText(title)
          await expect(node.locator('.cove-collapsed-window__message')).toHaveCount(0)
          await expect(node.locator('.cove-collapsed-window')).toHaveCSS('height', '96px')
          await expect(node.locator('.cove-collapsed-window__pixels')).toBeVisible()
        }
      }
    } finally {
      await electronApp.close()
    }
  })
}

test('dirty Document disclosure hands its title back beside the unsaved indicator without a jump', async ({
  browserName: _browserName,
}, testInfo) => {
  const fixture = await createMaterialFixture()
  const { electronApp, window } = await launchApp({
    env: { OPENCOVE_TEST_WORKSPACE: fixture.repo },
  })
  try {
    const documentNode = fixture.nodes.find(node => node.kind === 'document')!
    const id = documentNode.id
    await seedWorkspaceState(window, {
      activeWorkspaceId: 'document-endpoint-project',
      settings: {
        uiTheme: 'pixel',
        language: 'en',
        canvasInputMode: 'mouse',
        focusNodeOnClick: false,
        nodeCreationPixelEffectEnabled: false,
      },
      workspaces: [
        {
          id: 'document-endpoint-project',
          name: 'Document endpoint',
          path: fixture.repo,
          nodes: [{ ...documentNode, position: { x: 72, y: 80 }, width: 640, height: 420 }],
        },
      ],
    })
    const node = window.locator(`.react-flow__node[data-id="${id}"]`)
    await expect(node.locator('.monaco-editor')).toBeVisible()
    await window.locator('.react-flow__controls-fitview').click()
    await window.emulateMedia({ reducedMotion: 'no-preference' })
    const documentPath = path.join(fixture.repo, 'README.md')
    const savedContent = await readFile(documentPath, 'utf8')
    // Endpoint measurements may take longer than the real 650ms autosave delay.
    // Preserve this test's dirty-state premise without racing or disabling autosave.
    await rejectDocumentWrites(electronApp, toFileUri(documentPath))
    // Monaco can use EditContext instead of a textarea; focus its actual text surface.
    await node.locator('.monaco-editor .view-line').first().click()
    await window.keyboard.insertText('Unsaved draft for disclosure regression.\n')
    await expect(node.locator('.document-node__dirty-dot')).toBeVisible()
    await expect(node.locator('.monaco-editor')).toContainText('Unsaved draft')
    await expect(node.locator('.document-node__save-error')).toBeVisible()

    for (const direction of ['collapse', 'expand'] as const) {
      await pauseCollapseAnimations(window, id)
      await node.getByTestId(direction === 'collapse' ? 'node-collapse' : 'node-expand').click()
      await seekCollapseEndpoint(window)
      const lastAnimated = await readIdentityFrame(window, id, 'compact')
      await finishCollapseAnimations(window, id)
      const settled = await readIdentityFrame(
        window,
        id,
        direction === 'collapse' ? 'compact' : 'header',
      )
      await testInfo.attach(`dirty-document-${direction}-identity-handoff`, {
        body: JSON.stringify({ lastAnimated, settled }, null, 2),
        contentType: 'application/json',
      })
      expectIdentityEndpointContinuous(lastAnimated, settled)
    }
    await expect(node.locator('.document-node__dirty-dot')).toBeVisible()
    await expect(node.locator('.monaco-editor')).toContainText('Unsaved draft')
    expect(await readFile(documentPath, 'utf8')).toBe(savedContent)
    await testInfo.attach('dirty-document-expanded-endpoint', {
      body: await window.screenshot(),
      contentType: 'image/png',
    })
  } finally {
    await electronApp.close()
    await fixture.cleanup()
  }
})
