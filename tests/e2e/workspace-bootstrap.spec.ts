import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'

test('Control Surface project and space creation updates an open canvas without reload', async () => {
  const tempRoot = resolve('.codex-out/tmp')
  await mkdir(tempRoot, { recursive: true })
  const root = await mkdtemp(join(tempRoot, 'bootstrap-e2e-'))
  const projectPath = join(root, 'project')
  await mkdir(projectPath)
  const { electronApp, window } = await launchApp({ userDataDir: join(root, 'profile') })
  try {
    await seedWorkspaceState(window, {
      activeWorkspaceId: 'seed',
      workspaces: [{ id: 'seed', name: 'Seed', path: testWorkspacePath, nodes: [] }],
      settings: { isPrimarySidebarCollapsed: false },
    })
    const project = await window.evaluate(
      async path =>
        window.opencoveApi.controlSurface.invoke<{ projectId: string; spaceId: string }>({
          kind: 'command',
          id: 'project.add',
          payload: { path, name: 'Headless Project' },
        }),
      projectPath,
    )
    const sidebarProject = window.getByTestId(`workspace-item-${project.projectId}`)
    await expect(sidebarProject).toBeVisible()
    await sidebarProject.click()
    await expect(
      window.getByTestId(`workspace-space-item-${project.projectId}-${project.spaceId}`),
    ).toBeVisible()
    const space = await window.evaluate(
      async projectId =>
        window.opencoveApi.controlSurface.invoke<{ spaceId: string }>({
          kind: 'command',
          id: 'space.create',
          payload: { projectId, name: 'Headless Space' },
        }),
      project.projectId,
    )
    await expect(
      window.getByTestId(`workspace-space-item-${project.projectId}-${space.spaceId}`),
    ).toContainText('Headless Space')
    await expect(window.getByTestId(`workspace-space-menu-${space.spaceId}`)).toBeAttached()
  } finally {
    await electronApp.close()
    await rm(root, { recursive: true, force: true })
  }
})
