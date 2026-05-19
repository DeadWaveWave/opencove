import { expect, test, type Page } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
} from './workspace-canvas.helpers'

async function readWorkspaceSummary(window: Page): Promise<{
  activeWorkspaceId: string | null
  workspaceIds: string[]
  nodeIds: string[]
} | null> {
  return await window.evaluate(async () => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as {
      activeWorkspaceId?: string | null
      workspaces?: Array<{
        id?: string
        nodes?: Array<{ id?: string }>
      }>
    }

    const workspaces = Array.isArray(parsed.workspaces) ? parsed.workspaces : []
    return {
      activeWorkspaceId:
        typeof parsed.activeWorkspaceId === 'string' ? parsed.activeWorkspaceId : null,
      workspaceIds: workspaces
        .map(workspace => (typeof workspace.id === 'string' ? workspace.id : ''))
        .filter(Boolean),
      nodeIds: workspaces.flatMap(workspace =>
        Array.isArray(workspace.nodes)
          ? workspace.nodes
              .map(node => (typeof node.id === 'string' ? node.id : ''))
              .filter(Boolean)
          : [],
      ),
    }
  })
}

test.describe('Recovery - Empty Workspace Overwrite Guard', () => {
  test('preserves existing workspace data when an automatic empty workspace write happens', async () => {
    const userDataDir = await createTestUserDataDir()

    try {
      const { electronApp, window } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: false,
      })

      try {
        await clearAndSeedWorkspace(window, [
          {
            id: 'durable-note',
            title: 'Durable note',
            position: { x: 180, y: 160 },
            width: 360,
            height: 220,
            kind: 'note',
            status: null,
            task: { text: 'This note must survive accidental empty writes.' },
          },
        ])

        await expect(window.locator('.note-node')).toHaveCount(1)
        await expect(await readWorkspaceSummary(window)).toMatchObject({
          workspaceIds: ['workspace-seeded'],
          nodeIds: ['durable-note'],
        })

        const rejectedWrite = await window.evaluate(async () => {
          return await window.opencoveApi.persistence.writeAppState({
            state: {
              formatVersion: 1,
              activeWorkspaceId: null,
              workspaces: [],
              settings: { standardWindowSizeBucket: 'regular' },
            },
          })
        })

        expect(rejectedWrite).toMatchObject({
          ok: false,
          error: { code: 'persistence.invalid_state' },
        })
        await expect(await readWorkspaceSummary(window)).toMatchObject({
          workspaceIds: ['workspace-seeded'],
          nodeIds: ['durable-note'],
        })
      } finally {
        await electronApp.close()
      }

      const { electronApp: restartedApp, window: restartedWindow } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: true,
      })

      try {
        await expect(restartedWindow.locator('.note-node')).toHaveCount(1, { timeout: 30_000 })
        await expect(await readWorkspaceSummary(restartedWindow)).toMatchObject({
          activeWorkspaceId: 'workspace-seeded',
          workspaceIds: ['workspace-seeded'],
          nodeIds: ['durable-note'],
        })
      } finally {
        await restartedApp.close()
      }
    } finally {
      await removePathWithRetry(userDataDir)
    }
  })
})
