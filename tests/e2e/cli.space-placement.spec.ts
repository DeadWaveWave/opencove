import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, removePathWithRetry, seedWorkspaceState } from './workspace-canvas.helpers'
import { contains, type Rect } from './workspace-canvas.child-space.helpers'
import { jsonOutput, terminalCommand } from './cli.terminal.helpers'
import { createTerminalInSpace, focusSpace } from './cli.space.helpers'

// Use the public CLI for both creation and geometry reads, with a real terminal grant.
test('a note created in a full child Space grows its boundary inside its parent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opencove-cli-space-placement-'))
  const workspace = join(root, 'project')
  const projectId = 'placement-project'
  const parentId = 'placement-main'
  const briefId = 'placement-brief'
  let app: ElectronApplication | undefined
  try {
    await mkdir(workspace)
    const launched = await launchApp({
      userDataDir: join(root, 'profile'),
      cleanupUserDataDir: false,
      env: {
        OPENCOVE_TEST_WORKSPACE: workspace,
        OPENCOVE_WORKER_CLIENT: '0',
        OPENCOVE_E2E_DISABLE_CRASH_FALLBACK: '1',
      },
    })
    app = launched.electronApp
    const page = launched.window
    await seedWorkspaceState(page, {
      activeWorkspaceId: projectId,
      workspaces: [
        {
          id: projectId,
          name: 'Release planning',
          path: workspace,
          activeSpaceId: parentId,
          nodes: [
            {
              id: briefId,
              kind: 'note',
              title: 'Brief',
              position: { x: 80, y: 90 },
              width: 280,
              height: 300,
              task: { text: 'Prepare the 1.2 release: changelog, smoke tests, tag.' },
            },
          ],
          spaces: [
            {
              id: parentId,
              name: 'Main',
              directoryPath: workspace,
              nodeIds: [briefId],
              rect: { x: 20, y: 20, width: 1500, height: 900 },
            },
          ],
        },
      ],
    })
    const binding = await createTerminalInSpace(page, parentId)
    const child = jsonOutput(
      await terminalCommand(
        page,
        binding,
        'opencove space create --name "Release 1.2" --in @self --move "Brief"',
        'CREATE_CHILD',
      ),
    )
    expect(child).toMatchObject({ parentSpaceId: parentId, movedNodeIds: [briefId] })
    expect(child).toHaveProperty('rect')
    const childId = String(child.id)
    const created = jsonOutput(
      await terminalCommand(
        page,
        binding,
        `opencove node create note --space ${childId} --title Progress --text "Brief archived"`,
        'CREATE_NOTE',
      ),
    )
    const note = created.node as { id: string; spaceId: string; frame: Rect }
    expect(note.spaceId).toBe(childId)
    expect(note.frame.x).toBeGreaterThanOrEqual((child.rect as Rect).x + (child.rect as Rect).width)

    const childGet = jsonOutput(
      await terminalCommand(page, binding, `opencove space get --space ${childId}`, 'GET_CHILD'),
    ).space as { rect: Rect; nodeIds: string[] }
    const parentGet = jsonOutput(
      await terminalCommand(page, binding, `opencove space get --space ${parentId}`, 'GET_PARENT'),
    ).space as { rect: Rect; nodeIds: string[] }
    const noteGet = jsonOutput(
      await terminalCommand(page, binding, `opencove node get --node ${note.id}`, 'GET_NOTE'),
    ).node as { frame: Rect }
    expect(noteGet.frame).toEqual(note.frame)
    expect(childGet.nodeIds).toEqual([briefId, note.id])
    expect(parentGet.nodeIds).toEqual([binding.nodeId])
    expect(contains(childGet.rect, noteGet.frame, 24)).toBe(true)
    expect(contains(parentGet.rect, childGet.rect, 24)).toBe(true)
    const brief = jsonOutput(
      await terminalCommand(page, binding, `opencove node get --node ${briefId}`, 'GET_BRIEF'),
    ).node as { frame: Rect }
    expect(brief.frame).toEqual({ x: 80, y: 90, width: 280, height: 300 })
    expect(contains(childGet.rect, brief.frame)).toBe(true)
    await focusSpace(page, childId)
    await expect(page.locator(`[data-id="${note.id}"]`)).toBeInViewport()
    await test.info().attach('release-space-with-new-note', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  } finally {
    try {
      await app?.close()
    } finally {
      await removePathWithRetry(root)
    }
  }
})
