import { expect, type Locator, type Page } from '@playwright/test'
import {
  clearTerminalLinkSelection,
  terminalLinkCellPoint,
} from './workspace-canvas.terminal-links.helpers'

// The same valid PNG fixtures used by the existing Explorer preview and image-paste tests.
export const TERMINAL_LINK_WIDE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAGAAAAA2CAYAAAA4T5zSAAAAZ0lEQVR42u3RMQEAAAQAQVFEFVUTCtgtN3yBv8jq0V9hAgAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAdwv0rI6vE2ggVwAAAABJRU5ErkJggg==',
  'base64',
)
export const TERMINAL_LINK_SMALL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64',
)

export async function openTerminalImageLink(page: Page, nodeId: string): Promise<void> {
  await clearTerminalLinkSelection(page, nodeId)
  const point = await terminalLinkCellPoint(page, nodeId, 3, 1)
  await page.mouse.click(point.x, point.y)
  const actions = page.locator('[data-testid="terminal-link-actions"][role="dialog"]')
  await expect(actions).toBeVisible()
  const openFile = actions.getByRole('button', { name: 'Preview image', exact: true })
  await expect(openFile).toBeEnabled()
  await openFile.click()
  await expect(actions).toBeHidden()
}

export async function expectTerminalImageDocument(
  page: Page,
  dimensions: { width: number; height: number },
): Promise<Locator> {
  const documentNode = page.locator('.document-node')
  await expect(documentNode).toHaveCount(1)
  const image = documentNode.getByTestId('document-node-image')
  await expect(image).toBeVisible()
  await expect
    .poll(() =>
      image.evaluate(element => {
        const imageElement = element as HTMLImageElement
        return { width: imageElement.naturalWidth, height: imageElement.naturalHeight }
      }),
    )
    .toEqual(dimensions)
  await expect(documentNode.getByTestId('document-node-file-placeholder')).toHaveCount(0)
  await expect(documentNode.getByTestId('document-node-editor')).toHaveCount(0)
  await expect(documentNode.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
  await expect(page.locator('.image-node')).toHaveCount(0)
  return documentNode
}

export async function readImageDocumentNodeId(page: Page): Promise<string> {
  const node = page.locator('.react-flow__node').filter({ has: page.locator('.document-node') })
  await expect(node).toHaveCount(1)
  const id = await node.getAttribute('data-id')
  if (!id) {
    throw new Error('Missing image document node id')
  }
  return id
}
