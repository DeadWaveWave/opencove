import { expect, test } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'

const workspaceId = 'workspace-viewport-space'

function note(id: string, x: number) {
  return {
    id,
    title: id,
    position: { x, y: 200 },
    width: 320,
    height: 220,
    kind: 'note' as const,
    task: { text: id },
  }
}

test('the command entry names the Space the canvas is showing', async () => {
  const { electronApp, window } = await launchApp()
  try {
    await seedWorkspaceState(window, {
      activeWorkspaceId: workspaceId,
      workspaces: [
        {
          id: workspaceId,
          name: 'OpenCove',
          path: testWorkspacePath,
          nodes: [note('alpha-note', 200), note('beta-note', 4200)],
          spaces: [
            {
              id: 'space-alpha',
              name: 'Alpha',
              directoryPath: testWorkspacePath,
              nodeIds: ['alpha-note'],
              rect: { x: 0, y: 0, width: 900, height: 700 },
            },
            {
              id: 'space-beta',
              name: 'Beta',
              directoryPath: testWorkspacePath,
              nodeIds: ['beta-note'],
              rect: { x: 4000, y: 0, width: 900, height: 700 },
            },
          ],
          activeSpaceId: 'space-alpha',
        },
      ],
    })
    const entry = window.getByTestId('app-header-command-center')
    const space = window.getByTestId('app-header-active-space')
    await expect(entry).toContainText('OpenCove')
    await expect(space).toHaveText('Alpha')

    await window.getByTestId(`workspace-space-item-${workspaceId}-space-beta`).click()
    await expect(space).toHaveText('Beta')
  } finally {
    await electronApp.close()
  }
})
