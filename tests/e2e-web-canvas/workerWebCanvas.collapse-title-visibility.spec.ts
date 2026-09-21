/* eslint-disable no-await-in-loop -- Each disclosure cycle must settle naturally before the next. */
import { expect, test, type Locator } from '@playwright/test'
import {
  buildAppState,
  createWorkspaceDir,
  fileUri,
  openAuthedCanvas,
  writeAppState,
  writeTextFile,
} from './helpers'

async function waitForDisclosure(node: Locator): Promise<void> {
  await expect(node.locator('.cove-node-presentation')).not.toHaveAttribute(
    'data-cove-collapse-motion',
    /.+/,
  )
}

async function readTitle(title: Locator) {
  return title.evaluate(element => {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    const runtime = element.closest('.cove-node-presentation__runtime')!
    return {
      text: element.textContent,
      visibility: style.visibility,
      opacity: style.opacity,
      width: rect.width,
      runtimeVisibility: getComputedStyle(runtime).visibility,
      animations: element.getAnimations().map(animation => ({
        state: animation.playState,
        time: animation.currentTime,
      })),
    }
  })
}

test('restores window titles after persisted, interrupted, and push-away expansion', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const workspacePath = await createWorkspaceDir('collapse-title-visibility')
  const documentPath = `${workspacePath}/README.md`
  await writeTextFile(documentPath, '# Visible document title\n')
  await writeAppState(
    page.request,
    buildAppState({
      workspacePath,
      workspaceId: 'title-visibility-workspace',
      spaces: [],
      nodes: [
        {
          id: 'left-peer',
          title: 'Left peer window',
          kind: 'note',
          position: { x: 60, y: 80 },
          width: 460,
          height: 310,
          text: 'This left neighbor participates in push-away layout.',
        },
        {
          id: 'title-document',
          title: 'README.md',
          kind: 'document',
          position: { x: 460, y: 80 },
          width: 460,
          height: 280,
          uri: fileUri(documentPath),
        },
      ],
      settings: {
        language: 'en',
        uiTheme: 'pixel',
        canvasInputMode: 'mouse',
        nodeExpandBehavior: 'push-away',
        focusNodeOnClick: false,
        nodeCreationPixelEffectEnabled: false,
        uiFontScalePercent: 113,
      },
    }),
  )
  await page.addInitScript(() => {
    localStorage.setItem(
      'opencove:canvas-collapse:v1',
      JSON.stringify({
        'title-visibility-workspace': {
          collapsedNodeIds: { 'title-document': true, 'left-peer': true },
          collapsedSpaceIds: {},
        },
      }),
    )
  })
  await openAuthedCanvas(page)
  const peer = page.locator('.react-flow__node[data-id="left-peer"]')
  const document = page.locator('.react-flow__node[data-id="title-document"]')
  const documentTitle = document.locator('.document-node__title-text')
  const peerTitle = peer.locator('.node-title-editor__display')
  await expect(document.locator('.monaco-editor')).toBeAttached()
  await page.locator('.react-flow__controls-fitview').click()
  const samples: unknown[] = []
  try {
    for (const scenario of ['persisted', 'settled', 'interrupted', 'reversed']) {
      await page.locator('.react-flow__controls-fitview').click()
      for (const node of scenario === 'persisted' ? [] : [document, peer]) {
        // Dispatch through the real controls without Playwright waiting for the
        // moving shell to settle before the interruption or rapid reversal.
        await node.getByTestId('node-collapse').dispatchEvent('click')
        if (scenario === 'interrupted') {
          await node.locator('.cove-node-presentation').dispatchEvent('pointermove', { buttons: 1 })
        }
        if (scenario === 'reversed') {
          await node.getByTestId('node-expand').dispatchEvent('click')
          await node.getByTestId('node-collapse').dispatchEvent('click')
        }
        await waitForDisclosure(node)
      }
      expect((await readTitle(documentTitle)).runtimeVisibility).toBe('hidden')
      expect((await readTitle(peerTitle)).runtimeVisibility).toBe('hidden')
      for (const node of [document, peer]) {
        await node.getByTestId('node-expand').dispatchEvent('click')
        await waitForDisclosure(node)
      }
      const documentState = await readTitle(documentTitle)
      const peerState = await readTitle(peerTitle)
      samples.push({ scenario, documentState, peerState })
      expect(documentState).toMatchObject({
        text: 'README.md',
        visibility: 'visible',
        opacity: '1',
        runtimeVisibility: 'visible',
        animations: [],
      })
      expect(documentState.width).toBeGreaterThan(20)
      expect(peerState.visibility).toBe('visible')
      await expect(documentTitle).toBeVisible()
      await expect(peerTitle).toBeVisible()
    }
  } finally {
    await testInfo.attach('settled-title-states', {
      body: JSON.stringify(samples, null, 2),
      contentType: 'application/json',
    })
    if (!page.isClosed()) {
      await testInfo.attach('settled-window-titles', {
        body: await page.screenshot(),
        contentType: 'image/png',
      })
    }
  }
})
