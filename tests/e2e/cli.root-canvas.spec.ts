import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { CreateNodeResult, ListNodesResult } from '../../src/shared/contracts/dto/nodeControl'
import type { ListSpacesResult } from '../../src/shared/contracts/dto'
import { launchApp, removePathWithRetry, seedWorkspaceState } from './workspace-canvas.helpers'
import { SPACE_NODE_PADDING } from '../../src/contexts/workspace/domain/workspaceSpaceLayout'
import { readChildSpaceSnapshot } from './workspace-canvas.child-space.helpers'
import { jsonOutput, terminalCommand } from './cli.terminal.helpers'

const projectId = 'cli-root-project'
const spaceId = 'cli-root-space'

async function createTerminal(page: Page, inSpace: boolean) {
  const created = await page.evaluate(
    async payload => {
      return window.opencoveApi.controlSurface.invoke<CreateNodeResult>({
        kind: 'command',
        id: 'node.create',
        payload: {
          kind: 'terminal',
          ...(payload.inSpace
            ? { space: { kind: 'spaceId', spaceId: payload.spaceId } }
            : { projectId: payload.projectId }),
          frame: { x: payload.inSpace ? 80 : 2000, y: 100, width: 760, height: 540 },
          data: { shell: payload.shell },
        },
      })
    },
    {
      inSpace,
      spaceId,
      projectId,
      shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh',
    },
  )
  expect(created.spaceId).toBe(inSpace ? spaceId : null)
  if (!created.node.sessionId) {
    throw new Error('Created terminal has no session ID')
  }
  await page.evaluate(async nodeId => {
    await window.opencoveApi.controlSurface.invoke({
      kind: 'command',
      id: 'canvas.focus',
      payload: { target: { kind: 'node', nodeId } },
    })
  }, created.node.id)
  const binding = { nodeId: created.node.id, sessionId: created.node.sessionId }
  await expect(
    page.locator(`[data-id="${binding.nodeId}"] .terminal-node__terminal`),
  ).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 })
  return binding
}

async function expectRootNode(page: Page, result: CreateNodeResult) {
  expect(result.projectId).toBe(projectId)
  expect(result.spaceId).toBeNull()
  expect(result.node.spaceId).toBeNull()
  const spaces = await page.evaluate(async selectedProjectId => {
    return window.opencoveApi.controlSurface.invoke<ListSpacesResult>({
      kind: 'query',
      id: 'space.list',
      payload: { projectId: selectedProjectId },
    })
  }, projectId)
  const snapshot = await readChildSpaceSnapshot(page)
  for (const space of spaces.spaces) {
    expect(space.nodes.some(node => node.id === result.node.id)).toBe(false)
    const rect = snapshot.spaces[space.id]
    expect(rect, 'Seeded Space must retain its persisted rect').toBeTruthy()
    if (rect) {
      const frame = result.node.frame
      expect(
        frame.x + frame.width <= rect.x ||
          frame.x >= rect.x + rect.width ||
          frame.y + frame.height <= rect.y ||
          frame.y >= rect.y + rect.height,
      ).toBe(true)
    }
  }
}

test('canvas terminals create and list nodes on the root canvas', async () => {
  const testInfo = test.info()
  const root = await mkdtemp(join(tmpdir(), 'opencove-cli-root-'))
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
          name: 'CLI root canvas',
          path: workspace,
          activeSpaceId: spaceId,
          nodes: [],
          spaces: [
            {
              id: spaceId,
              name: 'Main',
              directoryPath: workspace,
              nodeIds: [],
              rect: { x: 20, y: 20, width: 1200, height: 800 },
            },
          ],
        },
      ],
    })
    // Real terminal creation issues the session grant and injects CLI identity.
    const inside = await createTerminal(page, true)
    const explicit = jsonOutput(
      await terminalCommand(
        page,
        inside,
        'opencove node create note --root-canvas --text hi',
        'ROOT_CREATE',
      ),
    ) as unknown as CreateNodeResult
    await expectRootNode(page, explicit)
    const callerSpace = (await readChildSpaceSnapshot(page)).spaces[spaceId]
    expect(callerSpace).toBeTruthy()
    const gap = explicit.node.frame.x - (callerSpace.x + callerSpace.width)
    expect(gap, 'Root creation must sit just right of the caller Space').toBeGreaterThanOrEqual(
      SPACE_NODE_PADDING,
    )
    expect(
      gap,
      'An empty slot beside the caller Space must not place the note far away',
    ).toBeLessThanOrEqual(100)

    const focused = jsonOutput(
      await terminalCommand(
        page,
        inside,
        `opencove canvas focus node --node ${explicit.node.id}`,
        'ROOT_FOCUS',
      ),
    )
    expect(focused.delivered).toBe(true)
    const note = page.locator(`[data-id="${explicit.node.id}"]`)
    await expect(note).toBeInViewport({ timeout: 15_000 })
    await expect(note).toContainText('hi')
    await testInfo.attach('root-canvas-note', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })

    const outside = await createTerminal(page, false)
    const implicit = jsonOutput(
      await terminalCommand(page, outside, 'opencove node create note', 'DEFAULT_CREATE'),
    ) as unknown as CreateNodeResult
    await expectRootNode(page, implicit)
    const listed = jsonOutput(
      await terminalCommand(
        page,
        outside,
        'opencove node list --fields id,spaceId',
        'DEFAULT_LIST',
      ),
    ) as unknown as ListNodesResult
    expect(listed.nodes).toEqual(
      expect.arrayContaining([
        { id: inside.nodeId, spaceId },
        { id: explicit.node.id, spaceId: null },
        { id: implicit.node.id, spaceId: null },
      ]),
    )
    const roots = jsonOutput(
      await terminalCommand(
        page,
        inside,
        'opencove node list --root-canvas --fields id,spaceId',
        'ROOT_LIST',
      ),
    ) as unknown as ListNodesResult
    expect(roots.nodes.length).toBeGreaterThanOrEqual(3)
    expect(roots.nodes.every(node => node.spaceId === null)).toBe(true)
  } finally {
    try {
      await app?.close()
    } finally {
      await removePathWithRetry(root)
    }
  }
})

test('root creation outside OpenCove requires a project before connecting', () => {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('OPENCOVE_')) {
      delete env[key]
    }
  }
  const result = spawnSync(
    process.execPath,
    [resolve('out/cli/opencove.mjs'), 'node', 'create', 'note', '--root-canvas'],
    { env, encoding: 'utf8' },
  )
  expect(result.status).toBe(2)
  expect(result.stdout).toBe('')
  expect(JSON.parse(result.stderr).error.message).toBe(
    '--root-canvas needs a project outside OpenCove: add --project <id>',
  )
})
