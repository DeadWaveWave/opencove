import { expect, test } from '@playwright/test'
import {
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  seedWorkspaceState,
  testWorkspacePath,
} from './workspace-canvas.helpers'
import { startWorker, stopWorker } from './worker-client.helpers'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

const activeWorkspaceId = 'workspace-root-terminal-active'
const unvisitedWorkspaceId = 'workspace-root-terminal-unvisited'

function persistedTerminal(id: string, title: string) {
  return {
    id,
    title,
    position: { x: 120, y: 140 },
    width: 520,
    height: 320,
    kind: 'terminal' as const,
    status: null,
    executionDirectory: testWorkspacePath,
    expectedDirectory: testWorkspacePath,
  }
}

test.describe('Workspace Canvas - Root terminal admission', () => {
  test('launches on the active workspace root while an unvisited workspace is initializing', async () => {
    const userDataDir = await createTestUserDataDir()
    let workerChild: ChildProcessWithoutNullStreams | null = null

    try {
      const worker = await startWorker({ userDataDir })
      workerChild = worker.child
      const { electronApp, window } = await launchApp({
        userDataDir,
        cleanupUserDataDir: false,
        env: { OPENCOVE_WORKER_CLIENT: '1' },
      })

      try {
        await seedWorkspaceState(window, {
          activeWorkspaceId,
          workspaces: [
            {
              id: activeWorkspaceId,
              name: 'Active root terminal workspace',
              path: testWorkspacePath,
              nodes: [persistedTerminal('terminal-active-existing', 'active-existing')],
              spaces: [],
              activeSpaceId: null,
            },
            {
              id: unvisitedWorkspaceId,
              name: 'Unvisited terminal workspace',
              path: testWorkspacePath,
              nodes: [persistedTerminal('terminal-unvisited-existing', 'unvisited-existing')],
              spaces: [],
              activeSpaceId: null,
            },
          ],
        })
      } finally {
        await electronApp.close()
      }

      await stopWorker(workerChild)
      workerChild = null
      const restartedWorker = await startWorker({ userDataDir })
      workerChild = restartedWorker.child

      const { electronApp: restartedApp, window: restartedWindow } = await launchApp({
        userDataDir,
        cleanupUserDataDir: false,
        env: { OPENCOVE_WORKER_CLIENT: '1' },
      })

      try {
        await expect(
          restartedWindow.locator(`[data-testid="workspace-item-${activeWorkspaceId}"]`),
        ).toHaveClass(/workspace-item--active/)
        await expect(restartedWindow.locator('.terminal-node')).toHaveCount(1, {
          timeout: 30_000,
        })
        const activeTerminal = restartedWindow.locator('.terminal-node').first()
        await expect(activeTerminal.locator('.xterm')).toBeVisible()
        await expect(activeTerminal.locator('.terminal-node__terminal')).toHaveAttribute(
          'aria-busy',
          'false',
          { timeout: 30_000 },
        )

        const created = await restartedWindow.evaluate(
          point => {
            return (
              window.__opencoveWorkspaceCanvasTestApi?.createTerminalAtFlowPoint(point) ?? false
            )
          },
          { x: 900, y: 700 },
        )
        expect(created).toBe(true)

        await expect(restartedWindow.locator('.terminal-node')).toHaveCount(2, {
          timeout: 15_000,
        })

        await expect
          .poll(async () => {
            return await restartedWindow.evaluate(async workspaceId => {
              const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
              if (!raw) {
                return null
              }

              const parsed = JSON.parse(raw) as {
                workspaces?: Array<{
                  id?: string
                  nodes?: Array<{ id?: string; kind?: string; title?: string }>
                  spaces?: Array<{ id?: string; nodeIds?: string[] }>
                }>
              }
              const workspace = parsed.workspaces?.find(candidate => candidate.id === workspaceId)
              const createdTerminal = workspace?.nodes?.find(
                node => node.kind === 'terminal' && node.id !== 'terminal-active-existing',
              )
              if (!createdTerminal?.id) {
                return null
              }

              return {
                nodeId: createdTerminal.id,
                owningSpaceId:
                  workspace?.spaces?.find(space => space.nodeIds?.includes(createdTerminal.id!))
                    ?.id ?? null,
              }
            }, activeWorkspaceId)
          })
          .toMatchObject({ owningSpaceId: null })
      } finally {
        await restartedApp.close()
      }
    } finally {
      await stopWorker(workerChild)
      await removePathWithRetry(userDataDir)
    }
  })
})
