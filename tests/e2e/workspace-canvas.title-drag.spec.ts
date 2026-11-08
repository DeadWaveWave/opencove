import { expect, test, type Locator, type Page } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

async function box(locator: Locator) {
  const value = await locator.boundingBox()
  expect(value).not.toBeNull()
  return value!
}

const WINDOWS = [
  {
    name: 'note',
    node: {
      id: 'note-title-drag',
      title: 'Release notes',
      position: { x: 160, y: 140 },
      width: 360,
      height: 240,
      kind: 'note' as const,
      task: { text: 'Every window title bar moves its window.' },
    },
    title: 'note-node-title-display',
    input: 'note-node-title-input',
  },
  {
    name: 'terminal',
    node: {
      id: 'terminal-title-drag',
      title: 'Release shell',
      position: { x: 160, y: 140 },
      width: 460,
      height: 280,
      kind: 'terminal' as const,
    },
    title: 'terminal-node-title-display',
    input: 'terminal-node-inline-title-input',
  },
]

/** Presses the title 24px in, optionally waits for the hold, then moves by `offset` and lets go. */
async function pressTitle(
  window: Page,
  title: Locator,
  offset: { x: number; y: number },
  hold: boolean,
): Promise<void> {
  const from = await box(title)
  const start = { x: from.x + 24, y: from.y + from.height / 2 }
  await window.mouse.move(start.x, start.y)
  await window.mouse.down()
  if (hold) {
    await expect(title).toHaveAttribute('data-cove-title-held', 'true')
  }
  await window.mouse.move(start.x + offset.x, start.y + offset.y, { steps: 8 })
  await window.mouse.up()
}

test.describe('Workspace Canvas - Title bar is the drag surface', () => {
  for (const kind of WINDOWS) {
    test(`renames the ${kind.name} from a click on its title, and moves it from a hold or a drag`, async () => {
      const { electronApp, window } = await launchApp()

      try {
        await clearAndSeedWorkspace(window, [kind.node])

        const node = window.locator(`.react-flow__node[data-id="${kind.node.id}"]`)
        const header = node.locator('[data-cove-part="window-header"]')
        const title = node.getByTestId(kind.title)
        const input = node.getByTestId(kind.input)
        await expect(title).toBeVisible()

        // No drag space sits beside the title: it runs to the controls.
        await expect(header.locator('.cove-window-header__drag')).toHaveCount(0)
        const titleBox = await box(title)
        const trailing = await box(header.locator('.cove-window-header__trailing'))
        expect(trailing.x - (titleBox.x + titleBox.width)).toBeLessThanOrEqual(12)

        // A click renames.
        await title.click()
        await expect(input).toBeFocused()
        await window.keyboard.press('Escape')
        await expect(input).toHaveCount(0)

        // A drag moves the window and renames nothing.
        const before = await box(node)
        await pressTitle(window, title, { x: 60, y: 40 }, false)
        await expect.poll(async () => (await box(node)).x - before.x).toBeGreaterThan(40)
        await expect(input).toHaveCount(0)

        // A hold let go in place renames nothing; a hold then a drag moves the window.
        await pressTitle(window, title, { x: 0, y: 0 }, true)
        await expect(title).not.toHaveAttribute('data-cove-title-held')
        await expect(input).toHaveCount(0)
        const held = await box(node)
        await pressTitle(window, title, { x: 0, y: 50 }, true)
        await expect.poll(async () => (await box(node)).y - held.y).toBeGreaterThan(30)
        await expect(input).toHaveCount(0)

        // The next click renames again.
        await title.click()
        await expect(input).toBeFocused()
      } finally {
        await electronApp.close()
      }
    })
  }
})
