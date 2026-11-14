import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GetSpaceResult, ListProjectsResult } from '../../src/shared/contracts/dto'
import { launchApp, removePathWithRetry, seedWorkspaceState } from './workspace-canvas.helpers'
import { contains, readChildSpaceSnapshot } from './workspace-canvas.child-space.helpers'
import { jsonOutput, terminalCommand } from './cli.terminal.helpers'

import { createTerminalInSpace, focusSpace } from './cli.space.helpers'

const projectId = 'cli-spaces-project'
const parentId = 'cli-spaces-parent'
const briefId = 'cli-spaces-brief'
const checklistId = 'cli-spaces-checklist'

test('a terminal grant creates top-level and child spaces and leaves project decisions to the user', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opencove-cli-spaces-'))
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
          name: 'CLI Spaces',
          path: workspace,
          activeSpaceId: parentId,
          nodes: [
            {
              id: briefId,
              kind: 'note',
              title: 'Brief',
              position: { x: 100, y: 120 },
              width: 240,
              height: 180,
              task: { text: 'Review the migration plan' },
            },
            {
              id: checklistId,
              kind: 'note',
              title: 'Checklist',
              position: { x: 100, y: 340 },
              width: 240,
              height: 180,
              task: { text: 'Check data compatibility' },
            },
          ],
          spaces: [
            {
              id: parentId,
              name: 'Main',
              directoryPath: workspace,
              nodeIds: [briefId, checklistId],
              rect: { x: 20, y: 20, width: 1500, height: 900 },
            },
          ],
        },
      ],
    })
    // Creation issues a real session grant; do not seed a session or identity variables.
    const binding = await createTerminalInSpace(page, parentId)
    const who = jsonOutput(await terminalCommand(page, binding, 'opencove whoami', 'IDENTITY'))
    expect(who).toMatchObject({
      caller: 'session-grant',
      projectId,
      spaceId: parentId,
      nodeId: binding.nodeId,
    })

    const top = jsonOutput(
      await terminalCommand(page, binding, 'opencove space create --name "Migration"', 'TOP_SPACE'),
    )
    expect(top).toMatchObject({
      name: 'Migration',
      projectId,
      parentSpaceId: null,
      directoryPath: workspace,
      movedNodeIds: [],
    })
    const topId = String(top.id)
    expect(topId).not.toBe('undefined')
    const snapshot = await readChildSpaceSnapshot(page)
    expect(top.rect).toEqual(snapshot.spaces[topId])
    expect(snapshot.spaces[topId].width).toBeGreaterThan(0)
    await focusSpace(page, topId)
    await expect(page.getByTestId(`workspace-space-label-${topId}`)).toHaveText('Migration')
    await test.info().attach('created-top-level-space', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })

    const child = jsonOutput(
      await terminalCommand(
        page,
        binding,
        'opencove space create --name "Review notes" --in @self --move "Brief" --move "Checklist"',
        'CHILD_SPACE',
      ),
    )
    expect(child).toMatchObject({
      name: 'Review notes',
      projectId,
      parentSpaceId: parentId,
      directoryPath: workspace,
      movedNodeIds: [briefId, checklistId],
    })
    const childId = String(child.id)
    const queried = await page.evaluate(
      async ids => {
        const get = (spaceId: string) =>
          window.opencoveApi.controlSurface.invoke<GetSpaceResult>({
            kind: 'query',
            id: 'space.get',
            payload: { spaceId },
          })
        return { child: await get(ids.childId), parent: await get(ids.parentId) }
      },
      { childId, parentId },
    )
    expect(queried.child.space.nodeIds).toEqual([briefId, checklistId])
    expect(queried.parent.space.nodeIds).toEqual([binding.nodeId])
    await focusSpace(page, childId)
    const region = page.getByTestId(`workspace-space-region-${childId}`)
    await expect(region).toHaveClass(/workspace-space-region--child/)
    await expect(region).toHaveAttribute('data-parent-space-id', parentId)
    await expect(page.getByTestId(`workspace-space-label-${childId}`)).toHaveText('Review notes')
    for (const [id, text] of [
      [briefId, 'Review the migration plan'],
      [checklistId, 'Check data compatibility'],
    ]) {
      const rendered = page.locator(`[data-id="${id}"]`)
      await expect(rendered).toBeInViewport({ timeout: 15_000 })
      await expect(rendered).toContainText(text)
    }
    const after = await readChildSpaceSnapshot(page)
    expect(child.rect).toEqual(after.spaces[childId])
    expect(contains(after.spaces[parentId], after.spaces[childId])).toBe(true)
    expect(contains(after.spaces[childId], after.nodes[briefId])).toBe(true)
    expect(contains(after.spaces[childId], after.nodes[checklistId])).toBe(true)
    await test.info().attach('child-space-with-moved-notes', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })

    // --directory is deliberately omitted above, avoiding shell-dependent path quoting.
    // Authorization must refuse before directory validation; no other credential is used.
    const denied = (
      await terminalCommand(
        page,
        binding,
        'opencove project add --path /agent-request -o json',
        'PROJECT_DENIED',
      )
    ).replaceAll('\n', '')
    expect(denied).toMatch(/\bexit=4\b/)
    expect(denied).toContain('common.forbidden')
    expect(denied).toContain('operation_denied')
    expect(denied).toContain('requires a human decision in OpenCove')
    expect(denied).toContain('Ask the user to add the project in OpenCove')
    // retryable:false is the envelope field; the message and hint must not suggest retrying.
    expect(denied.replace(/"retryable":false/g, '')).not.toMatch(/retry/i)
    const projects = await page.evaluate(async () =>
      window.opencoveApi.controlSurface.invoke<ListProjectsResult>({
        kind: 'query',
        id: 'project.list',
        payload: null,
      }),
    )
    expect(projects.projects.map(project => project.id)).toEqual([projectId])
  } finally {
    try {
      await app?.close()
    } finally {
      await removePathWithRetry(root)
    }
  }
})
