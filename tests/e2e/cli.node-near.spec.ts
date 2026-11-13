/* eslint-disable no-await-in-loop -- Each CLI creation observes the preceding committed geometry. */
import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, removePathWithRetry, seedWorkspaceState } from './workspace-canvas.helpers'
import { contains, type Rect } from './workspace-canvas.child-space.helpers'
import { jsonOutput, terminalCommand } from './cli.terminal.helpers'
import { createTerminalInSpace, focusSpace } from './cli.space.helpers'
import { writeLineageAgentStub } from './cli.agent-lineage.helpers'
import type { CanvasNodeDetailDto } from '../../src/shared/contracts/dto/nodeControl'

const frameArgument = (value: string) =>
  `'${process.platform === 'win32' ? value.replaceAll('"', '\\"') : value}'`

function nonOverlapping(a: Rect, b: Rect) {
  expect(
    a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y,
  ).toBe(true)
}

test('terminal-grant near creation persists and renders three helpers with nested containment and root override', async () => {
  test.setTimeout(240_000)
  const root = await mkdtemp(join(tmpdir(), 'opencove-cli-node-near-'))
  const workspace = join(root, 'project')
  const projectId = 'near-project',
    childId = 'near-child',
    parentId = 'near-parent'
  const briefFrame = { x: 1200, y: 1200, width: 280, height: 180 }
  const childFrame = { x: 1000, y: 1000, width: 4200, height: 2000 }
  const parentFrame = { x: 900, y: 900, width: 4400, height: 2700 }
  const docsFrame = { x: 1000, y: 3050, width: 800, height: 500 }
  let app: ElectronApplication | undefined
  try {
    await mkdir(workspace)
    const stub = await writeLineageAgentStub(root)
    const launched = await launchApp({
      userDataDir: join(root, 'profile'),
      cleanupUserDataDir: false,
      env: {
        OPENCOVE_TEST_WORKSPACE: workspace,
        OPENCOVE_WORKER_CLIENT: '0',
        OPENCOVE_TEST_USE_REAL_AGENTS: '0',
        OPENCOVE_TEST_AGENT_STUB_SCRIPT: stub,
        OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'claude-prompt-strict',
        OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
        OPENCOVE_TEST_CLAUDE_HOOK_INSTALL_FAILURE: '0',
        OPENCOVE_E2E_DISABLE_CRASH_FALLBACK: '1',
        CLAUDE_CONFIG_DIR: join(root, 'claude'),
        CODEX_HOME: join(root, 'codex'),
      },
    })
    app = launched.electronApp
    const page = launched.window
    await seedWorkspaceState(page, {
      activeWorkspaceId: projectId,
      settings: { defaultProvider: 'claude-code', standardWindowSizeBucket: 'regular' },
      workspaces: [
        {
          id: projectId,
          name: 'Near helpers',
          path: workspace,
          activeSpaceId: childId,
          nodes: [
            {
              id: 'brief',
              kind: 'note',
              title: 'Brief',
              position: { x: briefFrame.x, y: briefFrame.y },
              width: briefFrame.width,
              height: briefFrame.height,
              task: { text: 'Keep this fixed' },
            },
          ],
          spaces: [
            {
              id: parentId,
              name: 'Parent',
              directoryPath: workspace,
              nodeIds: [],
              rect: parentFrame,
            },
            {
              id: childId,
              name: 'Child',
              parentSpaceId: parentId,
              directoryPath: workspace,
              nodeIds: ['brief'],
              rect: childFrame,
            },
            {
              id: 'near-docs',
              name: 'Docs',
              parentSpaceId: parentId,
              directoryPath: workspace,
              nodeIds: [],
              rect: docsFrame,
            },
          ],
        },
      ],
    })
    const binding = await createTerminalInSpace(page, childId)
    // Move the real caller well away from the Space's top-left before exercising --near @self.
    await page.evaluate(
      async nodeId =>
        window.opencoveApi.controlSurface.invoke({
          kind: 'command',
          id: 'node.update',
          payload: { kind: 'terminal', nodeId, frame: { x: 3000, y: 2000 } },
        }),
      binding.nodeId,
    )
    const command = async (text: string, label: string) =>
      jsonOutput(await terminalCommand(page, binding, text, label))
    const getNode = async (id: string, label: string) =>
      (await command(`opencove node get --node ${id}`, label)).node as CanvasNodeDetailDto
    const getSpace = async (id: string, label: string) =>
      (await command(`opencove space get --space ${id}`, label)).space as {
        rect: Rect
        nodeIds: string[]
      }
    const caller = await getNode(binding.nodeId, 'CALLER_BEFORE')
    const childBefore = await getSpace(childId, 'CHILD_BEFORE')
    const parentBefore = await getSpace(parentId, 'PARENT_BEFORE')
    expect(caller.frame.x - childBefore.rect.x).toBeGreaterThan(1000)
    const nodes: CanvasNodeDetailDto[] = []
    for (const kind of ['note', 'terminal', 'agent']) {
      const args =
        kind === 'note'
          ? `--text "Near progress" --frame ${frameArgument(JSON.stringify({ width: 100, height: 100 }))}`
          : kind === 'agent'
            ? '--provider claude-code --prompt "Inspect the tests"'
            : ''
      const result = await command(
        `opencove node create ${kind} --near @self --title "Near ${kind}" ${args}`,
        `CREATE_${kind}`,
      )
      const node = result.node as CanvasNodeDetailDto
      expect(node).toMatchObject({
        projectId,
        spaceId: childId,
        spawnedBy: binding.nodeId,
        lineageDepth: 2,
      })
      if (kind === 'note') {
        expect(result).toMatchObject({
          frameAdjusted: true,
          appliedFrame: { width: 220, height: 140 },
        })
        expect(node.frame).toMatchObject({
          x: caller.frame.x + caller.frame.width + 24,
          y: caller.frame.y,
        })
      }
      if (kind === 'agent') {
        expect(node.frame.height).toBeGreaterThan(caller.frame.height)
      }
      const gap = Math.hypot(
        Math.max(
          caller.frame.x - node.frame.x - node.frame.width,
          node.frame.x - caller.frame.x - caller.frame.width,
          0,
        ),
        Math.max(
          caller.frame.y - node.frame.y - node.frame.height,
          node.frame.y - caller.frame.y - caller.frame.height,
          0,
        ),
      )
      expect(
        gap,
        `${kind} must remain within one node-width plus padding of the caller`,
      ).toBeLessThanOrEqual(node.frame.width + 24)
      // This roomy fixture has an edge-adjacent slot, including for the tall third helper.
      expect(gap).toBe(24)
      nonOverlapping(caller.frame, node.frame)
      nonOverlapping(briefFrame, node.frame)
      nonOverlapping(docsFrame, node.frame)
      nodes.forEach(previous => nonOverlapping(previous.frame, node.frame))
      expect((await getNode(node.id, `READ_${kind}`)).frame).toEqual(node.frame)
      nodes.push(node)
    }
    const child = await getSpace(childId, 'CHILD_AFTER'),
      parent = await getSpace(parentId, 'PARENT_AFTER')
    expect(child.nodeIds).toEqual(
      expect.arrayContaining(['brief', binding.nodeId, ...nodes.map(n => n.id)]),
    )
    expect(child.nodeIds).toHaveLength(5)
    expect(parent.nodeIds).toEqual([])
    nonOverlapping(child.rect, docsFrame)
    expect((await getSpace('near-docs', 'DOCS_AFTER')).rect).toEqual(docsFrame)
    expect(contains(parent.rect, docsFrame, 24)).toBe(true)
    expect(contains(child.rect, childBefore.rect)).toBe(true)
    expect(contains(parent.rect, parentBefore.rect)).toBe(true)
    expect(contains(parent.rect, child.rect, 24)).toBe(true)
    nodes.forEach(node => expect(contains(child.rect, node.frame, 24)).toBe(true))
    expect((await getNode(binding.nodeId, 'CALLER_AFTER')).frame).toEqual(caller.frame)
    expect((await getNode('brief', 'BRIEF_AFTER')).frame).toEqual(briefFrame)
    const rootNode = (
      await command(
        'opencove node create note --near @self --root-canvas --text "Root helper"',
        'ROOT_OVERRIDE',
      )
    ).node as CanvasNodeDetailDto
    expect(rootNode).toMatchObject({ projectId, spaceId: null, spawnedBy: binding.nodeId })
    nonOverlapping(rootNode.frame, child.rect)
    nonOverlapping(rootNode.frame, parent.rect)
    for (const node of [caller, ...nodes]) {
      nonOverlapping(rootNode.frame, node.frame)
    }
    expect((await getNode(rootNode.id, 'ROOT_READ')).frame).toEqual(rootNode.frame)
    expect((await getSpace(childId, 'ROOT_MEMBERSHIP')).nodeIds).toEqual(child.nodeIds)
    await focusSpace(page, parentId)
    for (const node of [caller, ...nodes, rootNode]) {
      const rendered = page.locator(`.react-flow__node[data-id="${node.id}"]`)
      await expect(rendered).toBeAttached()
      await expect
        .poll(() =>
          rendered.evaluate(element => {
            const matrix = new DOMMatrixReadOnly((element as HTMLElement).style.transform)
            return { x: matrix.m41, y: matrix.m42 }
          }),
        )
        .toEqual({ x: node.frame.x, y: node.frame.y })
    }
    await test.info().attach('near-helpers-nested-canvas', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    await page.evaluate(
      async nodeId =>
        window.opencoveApi.controlSurface.invoke({
          kind: 'command',
          id: 'canvas.focus',
          payload: { target: { kind: 'node', nodeId } },
        }),
      rootNode.id,
    )
    await expect(page.locator(`[data-id="${rootNode.id}"]`)).toBeInViewport()
    await test
      .info()
      .attach('near-explicit-root', { body: await page.screenshot(), contentType: 'image/png' })
  } finally {
    try {
      await app?.close()
    } finally {
      await removePathWithRetry(root)
    }
  }
})
