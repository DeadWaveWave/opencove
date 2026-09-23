/* eslint-disable no-await-in-loop -- Each creation must settle before the next menu targets the grown Space. */
import { expect, test, type Page } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  launchApp,
  seededWorkspaceId,
  testWorkspacePath,
} from './workspace-canvas.helpers'
import { openPaneContextMenuInSpace, rectsOverlap } from './workspace-canvas.arrange.shared'

interface Frame {
  x: number
  y: number
  width: number
  height: number
}
interface SavedNode {
  id: string
  kind: string
  position: { x: number; y: number }
  width: number
  height: number
}
interface SavedSpace {
  id: string
  parentSpaceId?: string | null
  nodeIds: string[]
  rect: Frame
}

async function readLayout(page: Page) {
  return page.evaluate(async workspaceId => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    const state = JSON.parse(raw ?? '{}') as {
      workspaces?: Array<{ id: string; nodes: SavedNode[]; spaces: SavedSpace[] }>
    }
    return state.workspaces?.find(workspace => workspace.id === workspaceId) ?? null
  }, seededWorkspaceId)
}

function visibleFrame(node: SavedNode, compactSize: { width: number; height: number }): Frame {
  return {
    ...node.position,
    width: node.id === 'compact' ? compactSize.width : node.width,
    height: node.id === 'compact' ? compactSize.height : node.height,
  }
}

function contains(outer: Frame, inner: Frame, padding = 24) {
  return (
    inner.x >= outer.x + padding &&
    inner.y >= outer.y + padding &&
    inner.x + inner.width <= outer.x + outer.width - padding &&
    inner.y + inner.height <= outer.y + outer.height - padding
  )
}

for (const nesting of ['root', 'child'] as const) {
  test(`creates Agent, terminal and note beside compact windows in a crowded ${nesting} Space`, async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp()
    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'compact',
            title: 'Compact note',
            kind: 'note',
            position: { x: 124, y: 124 },
            width: 1200,
            height: 900,
            task: { text: 'Keep my expanded dimensions.' },
          },
          {
            id: 'expanded',
            title: 'Expanded note',
            kind: 'note',
            position: { x: 276, y: 124 },
            width: 340,
            height: 260,
            task: { text: 'Keep this window visible.' },
          },
          {
            id: 'outside',
            title: 'Outside note',
            kind: 'note',
            position: { x: 720, y: 124 },
            width: 340,
            height: 260,
            task: { text: 'Do not overlap me.' },
          },
        ],
        {
          settings: {
            defaultProvider: 'codex',
            nodeCreationPixelEffectEnabled: false,
            focusNodeOnClick: false,
          },
          spaces: [
            ...(nesting === 'child'
              ? [
                  {
                    id: 'parent',
                    name: 'Parent',
                    directoryPath: testWorkspacePath,
                    nodeIds: [],
                    rect: { x: 76, y: 76, width: 588, height: 356 },
                  },
                ]
              : []),
            {
              id: 'target',
              name: 'Crowded',
              parentSpaceId: nesting === 'child' ? 'parent' : null,
              directoryPath: testWorkspacePath,
              nodeIds: ['compact', 'expanded'],
              rect: { x: 100, y: 100, width: 540, height: 308 },
            },
          ],
        },
      )
      await window.evaluate(workspaceId => {
        localStorage.setItem(
          'opencove:canvas-collapse:v1',
          JSON.stringify({
            [workspaceId]: { collapsedNodeIds: { compact: true }, collapsedSpaceIds: {} },
          }),
        )
      }, seededWorkspaceId)
      await window.reload()
      await expect(window.getByTestId('collapsed-node-compact')).toBeVisible()
      const compactSize = await window
        .locator('.react-flow__node[data-id="compact"]')
        .evaluate(element => ({
          width: (element as HTMLElement).offsetWidth,
          height: (element as HTMLElement).offsetHeight,
        }))
      const pane = window.locator('.workspace-canvas .react-flow__pane')
      for (const kind of ['agent', 'terminal', 'note'] as const) {
        await openPaneContextMenuInSpace(window, pane, 'target')
        await window
          .getByTestId(
            kind === 'agent'
              ? 'workspace-context-run-default-agent'
              : `workspace-context-new-${kind}`,
          )
          .click()
        await expect
          .poll(async () => {
            const layout = await readLayout(window)
            return (
              layout?.spaces
                .find(space => space.id === 'target')
                ?.nodeIds.filter(id =>
                  layout.nodes.some(
                    node =>
                      node.id === id && node.kind === kind && !['compact', 'expanded'].includes(id),
                  ),
                ).length ?? 0
            )
          })
          .toBe(1)
        await expect(window.getByTestId('collapsed-node-compact')).toBeVisible()
      }
      const layout = (await readLayout(window))!
      const target = layout.spaces.find(space => space.id === 'target')!
      expect(target.nodeIds).toHaveLength(5)
      expect(target.rect.width > 540 || target.rect.height > 308).toBe(true)
      expect(layout.nodes.find(node => node.id === 'compact')).toMatchObject({
        width: 1200,
        height: 900,
      })
      const frames = layout.nodes.map(node => ({ id: node.id, ...visibleFrame(node, compactSize) }))
      for (const [index, frame] of frames.entries()) {
        for (const peer of frames.slice(index + 1)) {
          expect(rectsOverlap(frame, peer)).toBe(false)
        }
        if (target.nodeIds.includes(frame.id)) {
          expect(contains(target.rect, frame)).toBe(true)
        }
      }
      if (nesting === 'child') {
        const parent = layout.spaces.find(space => space.id === 'parent')!
        expect(contains(parent.rect, target.rect)).toBe(true)
      }
      await window.locator('.react-flow__controls-fitview').click()
      await testInfo.attach(`${nesting}-space-visible-creation`, {
        body: await window.screenshot(),
        contentType: 'image/png',
      })
    } finally {
      await electronApp.close()
    }
  })
}
