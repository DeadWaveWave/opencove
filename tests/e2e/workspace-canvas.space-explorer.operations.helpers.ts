import { access } from 'node:fs/promises'
import { expect, type Locator, type Page } from '@playwright/test'
import { clearAndSeedWorkspace } from './workspace-canvas.helpers'

export function explorerEntry(window: Page, spaceId: string, uri: string): Locator {
  return window.locator(
    `[data-testid="workspace-space-explorer-entry-${spaceId}-${encodeURIComponent(uri)}"]`,
  )
}

export async function openExplorer(
  window: Page,
  spaceId: string,
  directoryPath: string,
): Promise<Locator> {
  await clearAndSeedWorkspace(
    window,
    [
      {
        id: `${spaceId}-anchor`,
        title: 'Anchor note',
        position: { x: 420, y: 320 },
        width: 320,
        height: 220,
        kind: 'note',
        task: {
          text: 'Keep this space alive',
        },
      },
    ],
    {
      spaces: [
        {
          id: spaceId,
          name: 'Explorer Space',
          directoryPath,
          nodeIds: [`${spaceId}-anchor`],
          rect: {
            x: 340,
            y: 280,
            width: 920,
            height: 520,
          },
        },
      ],
      activeSpaceId: spaceId,
    },
  )

  const spaceSwitch = window.locator(`[data-testid="workspace-space-switch-${spaceId}"]`)
  const filesPill = window.locator(`[data-testid="workspace-space-files-${spaceId}"]`)
  await expect(spaceSwitch).toBeVisible()

  if (!(await filesPill.isVisible())) {
    await spaceSwitch.click({ noWaitAfter: true })
  }

  await expect(filesPill).toBeVisible()
  await filesPill.click({ noWaitAfter: true })

  const explorer = window.locator('[data-testid="workspace-space-explorer"]')
  await expect(explorer).toBeVisible()
  return explorer
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

export async function dispatchExplorerShortcut(
  window: Page,
  options: {
    code: string
    key: string
    altKey?: boolean
    ctrlKey?: boolean
    metaKey?: boolean
    shiftKey?: boolean
  },
): Promise<void> {
  await window.evaluate(input => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        ...input,
        bubbles: true,
        cancelable: true,
      }),
    )
  }, options)
}
