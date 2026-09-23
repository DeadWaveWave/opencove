import { expect, test, type Page } from '@playwright/test'
import { toFileUri } from '../../src/contexts/filesystem/domain/fileUri'
import {
  launchApp,
  readCanvasViewport,
  readLocatorClientRect,
  seedWorkspaceState,
} from './workspace-canvas.helpers'
import { createFilesystemNodeFixture } from './workspace-canvas.filesystem-nodes.helpers'

async function dropNativePaths(page: Page, paths: string[], point: { x: number; y: number }) {
  const session = await page.context().newCDPSession(page)
  try {
    // Chromium creates genuine OS-backed File objects, exercising Electron's
    // webUtils path extraction instead of forging renderer-only file names.
    const data = { items: [], files: paths, dragOperationsMask: 1 }
    await session.send('Input.dispatchDragEvent', { type: 'dragEnter', ...point, data })
    await session.send('Input.dispatchDragEvent', { type: 'dragOver', ...point, data })
    await session.send('Input.dispatchDragEvent', { type: 'drop', ...point, data })
  } finally {
    await session.detach()
  }
}

test('native files and folders outside the project drop as compact references and expand at durable sizes', async ({
  browserName: _browserName,
}, testInfo) => {
  const project = await createFilesystemNodeFixture()
  const external = await createFilesystemNodeFixture()
  const { electronApp, window } = await launchApp({
    env: { OPENCOVE_TEST_WORKSPACE: project.root },
  })
  try {
    await window.setViewportSize({ width: 1520, height: 1040 })
    await seedWorkspaceState(window, {
      activeWorkspaceId: 'native-files',
      settings: {
        uiTheme: 'pixel',
        language: 'en',
        canvasInputMode: 'mouse',
        focusNodeOnClick: false,
        nodeCreationPixelEffectEnabled: false,
        nodeClosePixelEffectEnabled: false,
      },
      workspaces: [
        { id: 'native-files', name: 'Native files', path: project.root, nodes: [], spaces: [] },
      ],
    })
    const pane = window.locator('.workspace-canvas .react-flow__pane').first()
    const bounds = await readLocatorClientRect(pane)
    const point = { x: bounds.x + bounds.width * 0.45, y: bounds.y + bounds.height * 0.45 }
    const viewport = await readCanvasViewport(window)
    await dropNativePaths(window, [external.readme, external.docs], point)
    const compact = window.locator('.cove-collapsed-window')
    await expect(compact).toHaveCount(2)
    const fileIcon = compact.filter({ hasText: 'README.md' })
    const folderIcon = compact.filter({ hasText: 'docs' })
    await expect(fileIcon).toHaveText('README.md')
    await expect(folderIcon).toHaveText('docs')
    const firstBox = await readLocatorClientRect(fileIcon)
    expect(
      Math.hypot(
        firstBox.x + firstBox.width / 2 - point.x,
        firstBox.y + firstBox.height / 2 - point.y,
      ),
    ).toBeLessThan(3)
    expect(firstBox.width / viewport.zoom).toBeCloseTo(112, 0)
    expect(firstBox.height / viewport.zoom).toBeCloseTo(96, 0)
    expect(await readCanvasViewport(window)).toEqual(viewport)
    await testInfo.attach('native-compact-files', {
      body: await window.screenshot(),
      contentType: 'image/png',
    })

    await fileIcon.getByTestId('node-expand').click()
    const document = window.locator('.document-node').filter({ hasText: 'README.md' })
    await expect(document.locator('.monaco-editor')).toContainText('Canvas files')
    const expandedFile = await readLocatorClientRect(document)
    expect(expandedFile.width / viewport.zoom).toBeGreaterThan(128)
    await document.getByTestId('node-collapse').click()
    await expect(fileIcon).toBeVisible()
    await expect(window.locator('[data-cove-collapse-motion]')).toHaveCount(0)

    await folderIcon.getByTestId('node-expand').click()
    const folder = window.locator('.folder-node')
    await expect(folder.getByRole('listbox')).toBeVisible()
    await expect(folder.getByRole('listbox')).toContainText('design')
    await expect(folder.getByRole('navigation', { name: 'Path' })).toHaveText('docs')
    await folder.getByTestId('node-collapse').click()
    await expect(folderIcon).toBeVisible()
    await expect(window.locator('[data-cove-collapse-motion]')).toHaveCount(0)

    const readNodes = () =>
      window.evaluate(async () => {
        const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
        const state = JSON.parse(raw ?? '{}') as {
          workspaces?: Array<{
            id: string
            nodes: Array<{
              kind: string
              width: number
              height: number
              workerBinding?: unknown
              task?: { uri: string; rootUri?: string }
            }>
          }>
        }
        return state.workspaces?.find(item => item.id === 'native-files')?.nodes ?? []
      })
    await expect.poll(readNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'document',
          workerBinding: { endpointId: 'local', mountId: null },
          task: expect.objectContaining({ uri: toFileUri(external.readme) }),
        }),
        expect.objectContaining({
          kind: 'folder',
          workerBinding: { endpointId: 'local', mountId: null },
          task: expect.objectContaining({
            uri: toFileUri(external.docs),
            rootUri: toFileUri(external.docs),
          }),
        }),
      ]),
    )
    for (const node of await readNodes()) {
      expect(node.width).toBeGreaterThan(128)
      expect(node.height).toBeGreaterThan(112)
    }
    await window.reload()
    await expect(compact).toHaveCount(2)
    await fileIcon.getByTestId('node-expand').click()
    await expect(document.locator('.monaco-editor')).toContainText('Canvas files')
  } finally {
    await electronApp.close()
    await project.cleanup()
    await external.cleanup()
  }
})
