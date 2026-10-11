import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  dragMouse,
  launchApp,
  testWorkspacePath,
} from './workspace-canvas.helpers'
import {
  fitWorkspaceView,
  overlaps,
  readChildSpaceSnapshot,
} from './workspace-canvas.child-space.helpers'

test('resizing a child Space pushes parent windows, root windows, and sibling Space contents', async () => {
  const { electronApp, window } = await launchApp()
  try {
    await clearAndSeedWorkspace(
      window,
      [
        {
          id: 'parent-note',
          title: 'Parent note',
          kind: 'note',
          task: { text: 'Parent content' },
          position: { x: 760, y: 140 },
          width: 200,
          height: 160,
        },
        {
          id: 'root-note',
          title: 'Root note',
          kind: 'note',
          task: { text: 'Root content' },
          position: { x: 700, y: 330 },
          width: 180,
          height: 70,
        },
        {
          id: 'nested-note',
          title: 'Nested note',
          kind: 'note',
          task: { text: 'Nested content' },
          position: { x: 850, y: 480 },
          width: 160,
          height: 100,
        },
      ],
      {
        spaces: [
          {
            id: 'parent',
            name: 'Parent',
            directoryPath: testWorkspacePath,
            nodeIds: ['parent-note'],
            rect: { x: 0, y: 0, width: 1800, height: 1100 },
          },
          {
            id: 'child',
            name: 'Resize me',
            directoryPath: testWorkspacePath,
            parentSpaceId: 'parent',
            nodeIds: [],
            rect: { x: 100, y: 100, width: 564, height: 404 },
          },
          {
            id: 'sibling',
            name: 'Sibling',
            directoryPath: testWorkspacePath,
            parentSpaceId: 'parent',
            nodeIds: [],
            rect: { x: 800, y: 420, width: 600, height: 440 },
          },
          {
            id: 'nested',
            name: 'Nested',
            directoryPath: testWorkspacePath,
            parentSpaceId: 'sibling',
            nodeIds: ['nested-note'],
            rect: { x: 830, y: 460, width: 240, height: 160 },
          },
        ],
        activeSpaceId: null,
      },
    )
    const viewport = window.locator('.react-flow__viewport')
    const initialTransform = await viewport.evaluate(element => getComputedStyle(element).transform)
    await fitWorkspaceView(window)
    await expect
      .poll(() => viewport.evaluate(element => getComputedStyle(element).transform))
      .not.toBe(initialTransform)
    const before = await readChildSpaceSnapshot(window)
    const handle = window.getByTestId('workspace-space-drag-child-right')
    await handle.hover()
    // Fit View updates asynchronously. Read the handle and zoom from one rendered frame,
    // and verify the pointer will reach that handle before exercising collision behavior.
    const { start, zoom, hitsHandle } = await handle.evaluate(element => {
      const rect = element.getBoundingClientRect()
      const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      const viewportElement = document.querySelector('.react-flow__viewport')!
      return {
        start: point,
        zoom: new DOMMatrixReadOnly(getComputedStyle(viewportElement).transform).a,
        hitsHandle: element.contains(document.elementFromPoint(point.x, point.y)),
      }
    })
    expect(hitsHandle).toBe(true)
    await dragMouse(window, { start, end: { x: start.x + 300 * zoom, y: start.y }, steps: 18 })

    await expect
      .poll(async () => {
        const after = await readChildSpaceSnapshot(window)
        const child = after.spaces.child
        const sibling = after.spaces.sibling
        return {
          grew: child.width > before.spaces.child.width + 200,
          parentWindowClear: !overlaps(child, after.nodes['parent-note']),
          rootWindowClear: !overlaps(child, after.nodes['root-note']),
          siblingClear: !overlaps(child, sibling),
          parentStayed:
            JSON.stringify(after.spaces.parent) === JSON.stringify(before.spaces.parent),
          nestedCarried:
            after.spaces.nested.x - before.spaces.nested.x ===
              sibling.x - before.spaces.sibling.x &&
            after.spaces.nested.y - before.spaces.nested.y === sibling.y - before.spaces.sibling.y,
          nodeCarried:
            after.nodes['nested-note'].x - before.nodes['nested-note'].x ===
              sibling.x - before.spaces.sibling.x &&
            after.nodes['nested-note'].y - before.nodes['nested-note'].y ===
              sibling.y - before.spaces.sibling.y,
        }
      })
      .toEqual({
        grew: true,
        parentWindowClear: true,
        rootWindowClear: true,
        siblingClear: true,
        parentStayed: true,
        nestedCarried: true,
        nodeCarried: true,
      })
  } finally {
    await electronApp.close()
  }
})
