import { expect, type Page } from '@playwright/test'
import { PIXEL_EFFECTS_ENABLED } from './workspace-canvas.pixel-effects.helpers'
import {
  buildNodeEvalCommand,
  clearAndSeedWorkspace,
  testWorkspacePath,
  type SeedNode,
} from './workspace-canvas.helpers'

export const DRAG_NODE = 'drag-note-7'
const TERMINALS = 4

export async function prepareDragScene(page: Page, windowCount = 24) {
  const nodes: SeedNode[] = Array.from({ length: windowCount }, (_, index) => ({
    id: index < TERMINALS ? `drag-terminal-${index}` : `drag-note-${index}`,
    title: `Window ${index}`,
    kind: index < TERMINALS ? 'terminal' : 'note',
    position: { x: (index % 6) * 600, y: Math.floor(index / 6) * 400 },
    width: 360,
    height: 240,
    ...(index < TERMINALS ? {} : { task: { text: `Notes for window ${index}` } }),
  }))
  await clearAndSeedWorkspace(page, nodes, {
    settings: { uiTheme: 'dark', canvasFarViewEnabled: true, ...PIXEL_EFFECTS_ENABLED },
    spaces: Array.from({ length: 4 }, (_, index) => ({
      id: `drag-space-${index}`,
      name: `Space ${index}`,
      directoryPath: testWorkspacePath,
      nodeIds: nodes.slice(index * 6, index * 6 + 6).map(node => node.id),
      rect: { x: -40, y: index * 400 - 40, width: 3440, height: 280 },
    })),
  })
  await expect(
    page.getByTestId('workspace-space-minimap-workspace-seeded-drag-space-0'),
  ).toBeVisible()
  await expect(page.getByTestId('workspace-pixel-wall')).toHaveAttribute(
    'data-cove-wall-state',
    'ready',
  )
  await expect
    .poll(() =>
      page.evaluate(
        count =>
          Array.from({ length: count }, (_, index) =>
            window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(
              `drag-terminal-${index}`,
            ),
          ).filter(Boolean).length,
        TERMINALS,
      ),
    )
    .toBe(TERMINALS)
  // A live, idle PTY: no late shell prompt/scrollback updates in a commit measurement.
  await page.evaluate(
    async ({ count, command }) => {
      await Promise.all(
        Array.from({ length: count }, async (_, index) => {
          const sessionId = window.__opencoveTerminalSelectionTestApi!.getRuntimeSessionId(
            `drag-terminal-${index}`,
          )!
          await window.opencoveApi.pty.write({ sessionId, data: `${command}\r` })
        }),
      )
    },
    {
      count: TERMINALS,
      command: buildNodeEvalCommand(
        "process.stdout.write('DRAG_READY\\n');setInterval(()=>{},1000)",
      ),
    },
  )
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const state = JSON.parse(
          (await window.opencoveApi.persistence.readWorkspaceStateRaw()) ?? '{}',
        )
        return state.workspaces?.[0]?.nodes?.filter(
          (node: { id: string; scrollback?: string }) =>
            node.id.startsWith('drag-terminal-') && node.scrollback?.includes('DRAG_READY'),
        ).length
      }),
    )
    .toBe(TERMINALS)
  await page.evaluate(() => window.__opencoveWorkspaceCanvasTestApi!.setZoom(0.48))
  // Let viewport persistence, light fades and the sidebar's opening animation finish.
  await page.waitForTimeout(1200)
}

/** Real header mousedown, then renderer-owned mousemoves: no runner round trips between frames. */
export async function sampleContinuousDrag(page: Page, frameCount = 240) {
  const node = page.locator(`.react-flow__node[data-id="${DRAG_NODE}"]`)
  const header = node.getByTestId('note-node-header-drag-surface')
  await expect(header).toBeInViewport()
  const box = (await header.boundingBox())!
  const origin = { x: box.x + 10, y: box.y + box.height / 2 }
  await page.mouse.move(origin.x, origin.y)
  await page.mouse.down()
  await page.mouse.move(origin.x + 12, origin.y + 4)
  // The threshold move starts the drag; the next move applies its first layout projection.
  await page.mouse.move(origin.x + 14, origin.y + 4)
  await page.waitForTimeout(200)
  try {
    const result = await page.evaluate(
      async ({ start, frames, nodeId }) => {
        const api = window.__opencoveWorkspaceCanvasTestApi!
        api.resetWindowCommitCounts()
        const wall = window.__opencovePixelWallTestApi!
        const wallBefore = wall.getFrameCount()
        let minimapMutations = 0
        const dragged = document.querySelector<HTMLElement>(
          `.react-flow__node[data-id="${nodeId}"]`,
        )!
        const beforeTransform = dragged.style.transform
        let positionChanges = 0
        const positions = new MutationObserver(records => {
          positionChanges += records.length
        })
        positions.observe(dragged, { attributes: true, attributeFilter: ['style'] })
        const mutations = new MutationObserver(records => {
          minimapMutations += records.length
        })
        document.querySelectorAll('.workspace-space-minimap').forEach(minimap => {
          mutations.observe(minimap, { attributes: true, childList: true, subtree: true })
        })
        let rectReads = 0
        const readRect = Element.prototype.getBoundingClientRect
        Element.prototype.getBoundingClientRect = function () {
          rectReads++
          return readRect.call(this)
        }
        const longFrames: number[] = []
        const observer = new PerformanceObserver(list => {
          longFrames.push(...list.getEntries().map(entry => entry.duration))
        })
        observer.observe({ type: 'long-animation-frame' })
        const intervals: number[] = []
        const moves: number[] = []
        let previous = performance.now()
        try {
          for (let index = 0; index < frames; index++) {
            // eslint-disable-next-line no-await-in-loop -- one input per display frame.
            await new Promise<void>(resolve =>
              requestAnimationFrame(() => {
                const now = performance.now()
                intervals.push(now - previous)
                previous = now
                const before = performance.now()
                window.dispatchEvent(
                  new MouseEvent('mousemove', {
                    view: window,
                    bubbles: true,
                    buttons: 1,
                    clientX: start.x + 12 + 80 * Math.sin((index / (frames - 1)) * Math.PI * 4),
                    // Crossing a Space edge legitimately pushes neighboring windows.
                    clientY: start.y + 4,
                  }),
                )
                moves.push(performance.now() - before)
                resolve()
              }),
            )
          }
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        } finally {
          Element.prototype.getBoundingClientRect = readRect
          mutations.disconnect()
          positions.disconnect()
          longFrames.push(...observer.takeRecords().map(entry => entry.duration))
          observer.disconnect()
        }
        const sorted = [...intervals].sort((a, b) => a - b)
        const percentile = (q: number) =>
          sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!
        // Read while the button is still down: transient geometry must not have escaped to storage.
        const persisted = JSON.parse(
          (await window.opencoveApi.persistence.readWorkspaceStateRaw()) ?? '{}',
        )
        return {
          frames,
          fps: (1000 * frames) / intervals.reduce((sum, ms) => sum + ms, 0),
          p95: percentile(0.95),
          p99: percentile(0.99),
          over25ms: intervals.filter(ms => ms > 25).length,
          longFrames: longFrames.length,
          longFrameMs: longFrames.reduce((sum, ms) => sum + ms, 0),
          moveMs: moves.reduce((sum, ms) => sum + ms, 0),
          wallFrames: wall.getFrameCount() - wallBefore,
          windowCommits: api.getWindowCommitCounts(),
          windowCommitsByNode: api.getWindowCommitCountsByNode?.(),
          presentationCommits: api.getWindowPresentationCommitCounts?.(),
          persistedPositionDuringDrag: persisted.workspaces?.[0]?.nodes?.find(
            (item: { id: string }) => item.id === nodeId,
          )?.position,
          minimapMutations,
          rectReads,
          positionChanges,
          beforeTransform,
          afterTransform: dragged.style.transform,
          environment: {
            dpr: devicePixelRatio,
            focused: document.hasFocus(),
            visibility: document.visibilityState,
          },
        }
      },
      { start: origin, frames: frameCount, nodeId: DRAG_NODE },
    )
    expect(
      result.positionChanges,
      'the measured input must actually move the window',
    ).toBeGreaterThan(frameCount / 2)
    return result
  } finally {
    await page.mouse.up()
  }
}
