import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, removePathWithRetry, seedWorkspaceState } from './workspace-canvas.helpers'
import { contains, readChildSpaceSnapshot, type Rect } from './workspace-canvas.child-space.helpers'
import { jsonOutput, terminalCommand } from './cli.terminal.helpers'
import { createTerminalInSpace, focusSpace } from './cli.space.helpers'

const projectId = 'cli-space-update-project'
const parentId = 'cli-space-update-parent'
const targetId = 'cli-space-update-target'
const childId = 'cli-space-update-child'
const noteId = 'cli-space-update-note'
const nestedId = 'cli-space-update-nested'
const frameArgument = (value: object) => {
  const json = JSON.stringify(value)
  return `'${process.platform === 'win32' ? json.replaceAll('"', '\\"') : json}'`
}

test('a granted terminal renames and adjusts a Space boundary while its members stay in place', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opencove-cli-space-update-'))
  const workspace = join(root, 'project')
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
          name: 'Space updates',
          path: workspace,
          activeSpaceId: parentId,
          nodes: [
            {
              id: noteId,
              kind: 'note',
              title: 'Brief',
              position: { x: 100, y: 120 },
              width: 240,
              height: 180,
              task: { text: 'Keep the plan' },
            },
            {
              id: nestedId,
              kind: 'note',
              title: 'Nested',
              position: { x: 400, y: 120 },
              width: 240,
              height: 180,
              task: { text: 'Keep the details' },
            },
          ],
          spaces: [
            {
              id: parentId,
              name: 'Main',
              directoryPath: workspace,
              nodeIds: [],
              rect: { x: 0, y: 0, width: 1800, height: 1000 },
            },
            {
              id: targetId,
              parentSpaceId: parentId,
              name: 'Draft',
              directoryPath: workspace,
              nodeIds: [noteId],
              rect: { x: 40, y: 40, width: 700, height: 450 },
            },
            {
              id: childId,
              parentSpaceId: targetId,
              name: 'Details',
              directoryPath: workspace,
              nodeIds: [nestedId],
              rect: { x: 370, y: 90, width: 300, height: 250 },
            },
          ],
        },
      ],
    })
    // Shared harness creates the real terminal grant and waits for its shell.
    const binding = await createTerminalInSpace(page, parentId)
    const readSpace = async (id: string, label: string) =>
      jsonOutput(
        await terminalCommand(
          page,
          binding,
          `opencove space get --space ${id} --fields id,rect`,
          label,
        ),
      ).space as { id: string; rect: Rect }
    expect(
      jsonOutput(await terminalCommand(page, binding, 'opencove whoami', 'IDENTITY')),
    ).toMatchObject({ caller: 'session-grant', nodeId: binding.nodeId, projectId })

    const renamed = jsonOutput(
      await terminalCommand(
        page,
        binding,
        `opencove space update --space ${targetId} --name "Review"`,
        'RENAME',
      ),
    )
    expect(renamed).toMatchObject({
      id: targetId,
      name: 'Review',
      projectId,
      parentSpaceId: parentId,
      directoryPath: workspace,
      movedNodeIds: [],
    })
    const label = page.getByTestId(`workspace-space-label-${targetId}`)
    await expect(label).toHaveText('Review')

    // Notices and stdout share the PTY. Remove the notice before parsing stdout JSON.
    const shrunkOutput = (
      await terminalCommand(
        page,
        binding,
        `opencove space update --space "Review" --frame ${frameArgument({ width: 1, height: 1 })}`,
        'RESIZE',
      )
    ).replaceAll('\n', '')
    const notice = /Notice: space frame adjusted; applied frame: (\{[^}]+\})\./g
    const notices = [...shrunkOutput.matchAll(notice)]
    expect(notices).toHaveLength(1)
    const resized = jsonOutput(shrunkOutput.replace(notice, ''))
    expect(resized.frameAdjusted).toBe(true)
    expect(resized.appliedFrame).toEqual(JSON.parse(notices[0][1]))
    expect(resized.movedNodeIds).toEqual([])
    const resizedGet = await readSpace(targetId, 'GET_RESIZED')
    expect(resizedGet.rect).toEqual(resized.rect)
    const beforeGrowth = await readChildSpaceSnapshot(page)
    const rect = resized.rect as Rect
    expect(beforeGrowth.spaces[targetId]).toEqual(rect)
    expect(contains(rect, beforeGrowth.nodes[noteId], 24)).toBe(true)
    expect(contains(rect, beforeGrowth.spaces[childId], 12)).toBe(true)

    const grown = jsonOutput(
      await terminalCommand(
        page,
        binding,
        `opencove space update --space ${targetId} --frame ${frameArgument({ width: 2200, height: 1400 })}`,
        'GROW_BOUNDARY',
      ),
    )
    expect(grown.frameAdjusted).toBe(false)
    expect(grown.movedNodeIds).toEqual([])
    expect(grown.appliedFrame).toEqual({ ...rect, width: 2200, height: 1400 })
    await expect
      .poll(async () => (await readChildSpaceSnapshot(page)).spaces[targetId])
      .toEqual(grown.appliedFrame)
    const grownGet = await readSpace(targetId, 'GET_GROWN')
    expect(grownGet.rect).toEqual(grown.rect)
    expect(grownGet.rect).toEqual(grown.appliedFrame)
    const listed = jsonOutput(
      await terminalCommand(page, binding, 'opencove space list --fields id,rect', 'LIST_GROWN'),
    ).spaces as Array<{ id: string; rect: Rect }>
    expect(listed.find(space => space.id === targetId)).toEqual(grownGet)
    const parentGet = await readSpace(parentId, 'GET_PARENT')
    expect(contains(parentGet.rect, grownGet.rect, 12)).toBe(true)
    expect(parentGet.rect.width).toBeGreaterThan(beforeGrowth.spaces[parentId].width)
    expect(parentGet.rect.height).toBeGreaterThan(beforeGrowth.spaces[parentId].height)
    const afterGrowth = await readChildSpaceSnapshot(page)
    expect(afterGrowth.nodes).toEqual(beforeGrowth.nodes)
    expect(afterGrowth.spaces[childId]).toEqual(beforeGrowth.spaces[childId])
    expect(contains(grownGet.rect, afterGrowth.nodes[noteId], 24)).toBe(true)
    expect(contains(grownGet.rect, afterGrowth.spaces[childId], 12)).toBe(true)
    await focusSpace(page, targetId)
    await expect(label).toHaveText('Review')
    await test.info().attach('updated-space-boundary', {
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
