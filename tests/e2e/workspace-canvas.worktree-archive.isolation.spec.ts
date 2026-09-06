import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdir, mkdtemp, realpath } from 'node:fs/promises'
import path from 'node:path'
import { createRepo, runGit } from './m6.endpoints-mounts.legacy-repair.helpers'
import { launchApp, removePathWithRetry, seedWorkspaceState } from './workspace-canvas.helpers'
import { resolveE2ETmpDir } from './workspace-canvas.testUtils'

async function sampleWindowBackground(window: Page, node: Locator): Promise<Buffer> {
  // Sample a flat area: text antialiasing and caret blinking are unrelated to the overlay.
  const clip = await node.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: 8, height: 8 }
  })
  return await window.screenshot({ clip })
}

async function expectOverlayAboveNode(node: Locator, overlayId: string): Promise<void> {
  await expect
    .poll(() =>
      node.evaluate((element, id) => {
        const rect = element.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
        return hit?.closest(`[data-testid="${id}"]`) !== null && hit !== null
      }, overlayId),
    )
    .toBe(true)
}

for (const theme of ['light', 'dark'] as const) {
  for (const outcome of ['success', 'failure'] as const) {
    test(`isolates the archive overlay in ${theme} theme through ${outcome}`, async () => {
      const testInfo = test.info()
      const repoPath = await realpath(
        await mkdtemp(path.join(resolveE2ETmpDir(), 'opencove-archive-isolation-')),
      )
      try {
        await createRepo(repoPath)
        const worktreePath = path.join(repoPath, '.opencove', 'worktrees', 'archive')
        await mkdir(path.dirname(worktreePath), { recursive: true })
        await runGit(['worktree', 'add', '-b', 'feature/archive', worktreePath, 'HEAD'], repoPath)
        const { electronApp, window } = await launchApp({
          env: { OPENCOVE_TEST_WORKSPACE: repoPath },
        })
        try {
          await seedWorkspaceState(window, {
            activeWorkspaceId: 'archive-isolation',
            settings: { uiTheme: theme },
            workspaces: [
              {
                id: 'archive-isolation',
                name: 'Archive isolation',
                path: repoPath,
                nodes: [
                  {
                    id: 'archive-note',
                    title: 'Archive note',
                    kind: 'note',
                    position: { x: 220, y: outcome === 'failure' ? 260 : 180 },
                    width: 320,
                    height: 220,
                    task: { text: 'Archive me' },
                  },
                  {
                    id: 'other-note',
                    title: 'Other note',
                    kind: 'note',
                    position: { x: 950, y: 180 },
                    width: 320,
                    height: 220,
                    task: { text: 'Keep this window clear' },
                  },
                ],
                spaces: [
                  {
                    id: 'archive-space',
                    name: 'Archive Space',
                    directoryPath: worktreePath,
                    nodeIds: outcome === 'success' ? ['archive-note'] : [],
                    rect: { x: 180, y: 140, width: 620, height: 420 },
                  },
                  {
                    id: 'other-space',
                    name: 'Other Space',
                    directoryPath: repoPath,
                    nodeIds: ['other-note'],
                    rect: { x: 900, y: 140, width: 620, height: 420 },
                  },
                  ...(outcome === 'failure'
                    ? [
                        {
                          id: 'child-space',
                          name: 'Child Space',
                          directoryPath: worktreePath,
                          parentSpaceId: 'archive-space',
                          nodeIds: ['archive-note'],
                          rect: { x: 200, y: 220, width: 360, height: 300 },
                        },
                      ]
                    : []),
                ],
                activeSpaceId: 'archive-space',
              },
            ],
          })
          await expect(window.locator('html')).toHaveAttribute('data-cove-theme', theme)
          const target = window.locator('.react-flow__node[data-id="archive-note"]')
          const other = window.locator('.react-flow__node[data-id="other-note"]')
          await expect(other).toBeVisible()
          await window.locator('.react-flow__controls-fitview').click()
          const before = await sampleWindowBackground(window, other)

          // Hold the real archive command at the IPC boundary; release it explicitly instead of
          // relying on git timing. Other control-surface requests retain their real handlers.
          await electronApp.evaluate(({ ipcMain }) => {
            const handlers = (
              ipcMain as unknown as {
                _invokeHandlers: Map<string, (event: unknown, request: unknown) => unknown>
              }
            )._invokeHandlers
            const channel = 'control-surface:invoke'
            const original = handlers.get(channel)
            if (!original) {
              throw new Error('Missing control-surface IPC handler')
            }
            const released = new Promise<string>(resolve => {
              ipcMain.once('opencove-test:release-archive', resolve)
            })
            ipcMain.removeHandler(channel)
            ipcMain.handle(channel, async (event, request: { id?: string }) => {
              if (request.id === 'gitWorktree.removeInMount') {
                const result = await released
                if (result === 'failure') {
                  return {
                    __opencoveIpcEnvelope: true,
                    ok: false,
                    error: { code: 'worktree.remove_failed' },
                  }
                }
              }
              return await original(event, request)
            })
          })
          await window.getByTestId('workspace-space-menu-archive-space').click()
          await window.getByTestId('workspace-space-action-archive').click()
          await expect(window.getByTestId('space-worktree-archive-submit')).toBeEnabled()
          expect((await sampleWindowBackground(window, other)).equals(before)).toBe(true)
          await window.getByTestId('space-worktree-archive-submit').click()
          const overlayId = 'workspace-space-operation-archive-space'
          await expect(window.getByTestId(overlayId)).toBeVisible()
          await expect(window.getByTestId('workspace-space-operation-other-space')).toHaveCount(0)
          await expectOverlayAboveNode(target, overlayId)
          await testInfo.attach(`archive-running-${theme}`, {
            body: await window.screenshot(),
            contentType: 'image/png',
          })
          expect(
            (await sampleWindowBackground(window, other)).equals(before),
            'An unrelated window must not be tinted by its Space background',
          ).toBe(true)
          await other.locator('textarea').click()
          await other.locator('textarea').fill('Still editable during archive')
          await expect(other.locator('textarea')).toHaveValue('Still editable during archive')

          await window.locator('.react-flow__controls-fitview').click()
          await window.locator('.react-flow__controls-zoomout').click()
          await expectOverlayAboveNode(target, overlayId)
          await electronApp.evaluate(({ ipcMain }, result) => {
            ipcMain.emit('opencove-test:release-archive', result)
          }, outcome)
          await expect(window.getByTestId(overlayId)).toHaveCount(0)
          if (outcome === 'success') {
            await expect(target).toHaveCount(0)
          } else {
            await expect(target).toBeVisible()
            await expect(window.getByTestId('space-worktree-window')).toBeVisible()
            await window.getByTestId('space-worktree-archive-cancel').click()
            await target.locator('textarea').click()
            await target.locator('textarea').fill('Editable again after failure')
          }
          await expect(other.locator('textarea')).toHaveValue('Still editable during archive')
          await testInfo.attach(`archive-${outcome}-${theme}`, {
            body: await window.screenshot(),
            contentType: 'image/png',
          })
        } finally {
          await electronApp.close()
        }
      } finally {
        await removePathWithRetry(repoPath)
      }
    })
  }
}
