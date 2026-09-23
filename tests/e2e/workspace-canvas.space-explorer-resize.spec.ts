import { expect, test } from '@playwright/test'
import { dragMouse, launchApp, readLocatorClientRect } from './workspace-canvas.helpers'
import {
  createFilesystemNodeFixture,
  seedFilesystemWorkspace,
} from './workspace-canvas.filesystem-nodes.helpers'

test('resizes Explorer through the left and footer edges and lower corners at canvas zoom', async () => {
  const fixture = await createFilesystemNodeFixture()
  const { electronApp, window } = await launchApp({
    env: { OPENCOVE_TEST_WORKSPACE: fixture.root },
  })
  try {
    await seedFilesystemWorkspace(window, fixture.root, 'pixel')
    const explorer = window.getByTestId('workspace-space-explorer')
    await window.locator('.react-flow__controls-zoomout').click()
    await expect
      .poll(async () =>
        explorer.evaluate(node => {
          const element = node as HTMLElement
          return element.getBoundingClientRect().width / element.offsetWidth
        }),
      )
      .toBeLessThan(0.95)
    // Wait until the viewport settles before translating pointer deltas.
    await window.waitForTimeout(350)
    const readFrame = () =>
      explorer.evaluate(node => {
        const element = node as HTMLElement
        const rect = element.getBoundingClientRect()
        return {
          x: rect.x,
          y: rect.y,
          width: element.offsetWidth,
          height: element.offsetHeight,
          scale: rect.width / element.offsetWidth,
        }
      })
    const resize = async (edge: string, dx: number, dy: number) => {
      const before = await readFrame()
      const handle = await readLocatorClientRect(
        explorer.getByTestId(`workspace-space-explorer-resizer-${edge}`),
      )
      const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
      await dragMouse(window, {
        start,
        end: { x: start.x + dx * before.scale, y: start.y + dy * before.scale },
      })
      return before
    }
    const initial = await resize('bottom', 0, -100)
    await expect.poll(async () => (await readFrame()).height).toBeCloseTo(initial.height - 100, 0)
    let current = await readFrame()
    expect(current.width).toBe(initial.width)
    expect(Math.abs(current.y - initial.y)).toBeLessThan(1.5)
    const beforeRight = await resize('bottom-right', 80, 35)
    await expect.poll(async () => (await readFrame()).width).toBeCloseTo(beforeRight.width + 80, 0)
    await expect
      .poll(async () => (await readFrame()).height)
      .toBeCloseTo(beforeRight.height + 35, 0)
    const beforeLeft = await resize('bottom-left', 40, -35)
    await expect.poll(async () => (await readFrame()).width).toBeCloseTo(beforeLeft.width - 40, 0)
    await expect.poll(async () => (await readFrame()).height).toBeCloseTo(beforeLeft.height - 35, 0)
    current = await readFrame()
    expect(
      Math.abs(
        current.x +
          current.width * current.scale -
          beforeLeft.x -
          beforeLeft.width * beforeLeft.scale,
      ),
    ).toBeLessThan(2)
    const beforeLeftEdge = await resize('left', 20, 0)
    await expect
      .poll(async () => (await readFrame()).width)
      .toBeCloseTo(beforeLeftEdge.width - 20, 0)
    current = await readFrame()
    expect(current.height).toBe(beforeLeftEdge.height)
    expect(
      Math.abs(
        current.x +
          current.width * current.scale -
          beforeLeftEdge.x -
          beforeLeftEdge.width * beforeLeftEdge.scale,
      ),
    ).toBeLessThan(2)
    await expect(explorer.getByRole('navigation', { name: 'Path' })).toBeVisible()
  } finally {
    await electronApp.close()
    await fixture.cleanup()
  }
})
