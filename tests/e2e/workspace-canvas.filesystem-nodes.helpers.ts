import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, type Locator, type Page } from '@playwright/test'
import { toFileUri } from '../../src/contexts/filesystem/domain/fileUri'
import { dragLocatorTo, removePathWithRetry, seedWorkspaceState } from './workspace-canvas.helpers'
import { resolveE2ETmpDir } from './workspace-canvas.testUtils'

export const FILESYSTEM_SPACE = 'filesystem-space'

export async function createFilesystemNodeFixture() {
  const root = await mkdtemp(path.join(resolveE2ETmpDir(), 'opencove-filesystem-nodes-'))
  const docs = path.join(root, 'docs')
  const design = path.join(docs, 'design')
  const guide = path.join(design, 'guide.md')
  const readme = path.join(root, 'README.md')
  await mkdir(design, { recursive: true })
  await mkdir(path.join(docs, 'assets'))
  await writeFile(guide, '# Nested guide\nKeep this file in docs/design.\n')
  await writeFile(readme, '# Canvas files\nThis document was dragged from the Explorer.\n')
  await writeFile(path.join(docs, 'note10.md'), 'Ten\n')
  await writeFile(path.join(docs, 'note2.md'), 'Two\n')
  await writeFile(path.join(docs, 'theme.ts'), 'export const theme = "pixel"\n')
  return { root, docs, design, guide, readme, cleanup: () => removePathWithRetry(root) }
}

export async function seedFilesystemWorkspace(
  page: Page,
  root: string,
  theme: 'pixel' | 'pixel-light',
) {
  await page.setViewportSize({ width: 1520, height: 1040 })
  await seedWorkspaceState(page, {
    activeWorkspaceId: 'filesystem-project',
    settings: {
      uiTheme: theme,
      language: 'en',
      canvasInputMode: 'mouse',
      focusNodeOnClick: false,
      nodeCreationPixelEffectEnabled: false,
      nodeClosePixelEffectEnabled: false,
    },
    workspaces: [
      {
        id: 'filesystem-project',
        name: 'File workspace',
        path: root,
        nodes: [],
        spaces: [
          {
            id: FILESYSTEM_SPACE,
            name: 'Source workspace',
            directoryPath: root,
            nodeIds: [],
            rect: { x: 60, y: 70, width: 670, height: 550 },
          },
        ],
      },
    ],
  })
  await page.getByTestId(`workspace-space-files-${FILESYSTEM_SPACE}`).click()
  await expect(page.getByTestId('workspace-space-explorer')).toBeVisible()
}

export function directoryEntry(page: Page, ownerId: string, entryPath: string) {
  return page.getByTestId(
    `workspace-space-explorer-entry-${ownerId}-${encodeURIComponent(toFileUri(entryPath))}`,
  )
}

export async function dragEntryToCanvas(page: Page, entry: Locator, y = 230) {
  const canvas = page.locator('.workspace-canvas .react-flow__pane').first()
  const targetPosition = await canvas.evaluate((pane, preferredY) => {
    const box = pane.getBoundingClientRect()
    const candidates = [
      { x: box.width - 370, y: preferredY },
      { x: box.width - 24, y: preferredY },
      { x: box.width / 2, y: box.height - 24 },
      { x: box.width / 2, y: 24 },
    ]
    return (
      candidates.find(point => {
        const target = document.elementFromPoint(box.x + point.x, box.y + point.y)
        return (
          target?.closest('.workspace-canvas') &&
          !target.closest(
            '.react-flow__node, .workspace-space-explorer, .react-flow__panel, .react-flow__minimap',
          )
        )
      }) ?? null
    )
  }, y)
  if (!targetPosition) {
    throw new Error('No blank canvas target is visible for the filesystem drop')
  }
  await dragLocatorTo(page, entry, canvas, {
    targetPosition,
  })
}

export async function readPersistedFolder(page: Page) {
  return page.evaluate(async () => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    if (!raw) {
      return null
    }
    const state = JSON.parse(raw) as {
      workspaces: Array<{
        nodes: Array<{
          kind: string
          title: string
          task?: { uri: string; viewMode: string; expandedDirectoryUris: string[] }
        }>
      }>
    }
    return (
      state.workspaces.flatMap(workspace => workspace.nodes).find(node => node.kind === 'folder')
        ?.task ?? null
    )
  })
}
