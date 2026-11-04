import { expect, test } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'

test('a Space card maps its windows and flies to the one clicked', async () => {
  const { electronApp, window } = await launchApp()
  try {
    await seedWorkspaceState(window, {
      activeWorkspaceId: 'card-project',
      workspaces: [
        {
          id: 'card-project',
          name: 'Cards',
          path: testWorkspacePath,
          nodes: [
            {
              id: 'card-terminal',
              title: 'pnpm test',
              position: { x: 0, y: 0 },
              width: 420,
              height: 260,
              kind: 'terminal',
              status: null,
            },
            {
              id: 'card-note',
              title: 'Release notes',
              position: { x: 2400, y: 1400 },
              width: 320,
              height: 220,
              kind: 'note',
              status: null,
              task: { text: 'Release notes' },
            },
          ],
          spaces: [
            {
              id: 'card-space',
              name: 'release',
              directoryPath: testWorkspacePath,
              labelColor: 'purple',
              nodeIds: ['card-terminal', 'card-note'],
              rect: { x: -40, y: -40, width: 2800, height: 1700 },
            },
          ],
          activeSpaceId: 'card-space',
        },
      ],
    })

    const minimap = window.getByTestId('workspace-space-minimap-card-project-card-space')
    await expect(minimap).toBeVisible()
    await expect(minimap.locator('[data-node-id="card-terminal"]')).toHaveAttribute(
      'data-family',
      'shell',
    )
    const note = minimap.locator('[data-node-id="card-note"]')
    await expect(note).toHaveAttribute('data-family', 'knowledge')
    await expect(window.getByTestId('workspace-space-item-card-project-card-space')).toContainText(
      '2 windows',
    )

    await note.click()
    const canvas = window.locator('.workspace-canvas .react-flow')
    const noteNode = window.locator('.react-flow__node[data-id="card-note"]')
    await expect
      .poll(async () => {
        const canvasBox = await canvas.boundingBox()
        const noteBox = await noteNode.boundingBox()
        if (!canvasBox || !noteBox) {
          return Number.POSITIVE_INFINITY
        }
        return Math.hypot(
          noteBox.x + noteBox.width / 2 - (canvasBox.x + canvasBox.width / 2),
          noteBox.y + noteBox.height / 2 - (canvasBox.y + canvasBox.height / 2),
        )
      })
      .toBeLessThan(40)
  } finally {
    await electronApp.close()
  }
})
