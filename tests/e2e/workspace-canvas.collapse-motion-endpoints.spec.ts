/* eslint-disable no-await-in-loop -- Disclosure endpoints are sampled sequentially. */
import { expect, test } from '@playwright/test'
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
      await node.getByTestId('terminal-node-title-display').click()
      await node.getByTestId('terminal-node-inline-title-input').fill(title)
      await node.getByTestId('terminal-node-inline-title-input').press('Enter')

      for (const direction of ['collapse', 'expand'] as const) {
        await pauseCollapseAnimations(window, EXPANSION_TERMINAL)
        await node.getByTestId(direction === 'collapse' ? 'node-collapse' : 'node-expand').click()
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
          const message = node.locator('.cove-collapsed-window__message')
          await expect(message).toContainText('等待新消息')
          const alignment = await message.evaluate(element => {
            const range = document.createRange()
            range.selectNodeContents(element)
            const text = range.getBoundingClientRect()
            const box = element.getBoundingClientRect()
            const viewport = element.closest('.react-flow__viewport')!
            const zoom = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a
            return {
              inset: (box.width - text.width) / zoom,
              offset: Math.abs(box.x + box.width / 2 - text.x - text.width / 2) / zoom,
            }
          })
          expect(alignment.inset, 'The message fixture fits without truncation').toBeGreaterThan(8)
          expect(alignment.offset, 'Agent message text is centered beneath the icon').toBeLessThan(
            1,
          )
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
    // Monaco can use EditContext instead of a textarea; focus its actual text surface.
    await node.locator('.monaco-editor .view-line').first().click()
    await window.keyboard.insertText('Unsaved draft for disclosure regression.\n')
    await expect(node.locator('.document-node__dirty-dot')).toBeVisible()
    await expect(node.locator('.monaco-editor')).toContainText('Unsaved draft')

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
    await testInfo.attach('dirty-document-expanded-endpoint', {
      body: await window.screenshot(),
      contentType: 'image/png',
    })
  } finally {
    await electronApp.close()
    await fixture.cleanup()
  }
})
