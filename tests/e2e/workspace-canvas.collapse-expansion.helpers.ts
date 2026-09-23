/* eslint-disable no-await-in-loop -- Pointer moves are paced to render frames for visual regression sampling. */
import { expect, type Page } from '@playwright/test'
import {
  buildNodeEvalCommand,
  readLocatorClientRect,
  seedWorkspaceState,
  testWorkspacePath,
} from './workspace-canvas.helpers'

export const EXPANSION_PROJECT = 'collapse-expansion-project'
export const EXPANSION_TERMINAL = 'collapse-expansion-terminal'
export const EXPANSION_PEER = 'collapse-expansion-peer'

export interface NodeFrame {
  x: number
  y: number
  width: number
  height: number
}

export interface DragFrame {
  node: NodeFrame
  selection: NodeFrame | null
  runtime: { width: number; height: number }
}

interface DragProbe {
  samples: DragFrame[]
  frameId: number
  active: boolean
}

type ProbeWindow = Window & { __opencoveCollapseExpansionProbe?: DragProbe }

export async function seedExpansionFixture(page: Page, behavior?: 'find-space') {
  await seedWorkspaceState(page, {
    activeWorkspaceId: EXPANSION_PROJECT,
    settings: {
      uiTheme: 'pixel',
      language: 'en',
      canvasInputMode: 'mouse',
      focusNodeOnClick: false,
      standbyBannerEnabled: false,
      ...(behavior ? { nodeExpandBehavior: behavior } : {}),
    },
    workspaces: [
      {
        id: EXPANSION_PROJECT,
        name: 'Expansion geometry',
        path: testWorkspacePath,
        nodes: [
          {
            id: EXPANSION_TERMINAL,
            title: 'Live terminal',
            kind: 'terminal',
            executionDirectory: testWorkspacePath,
            position: { x: 72, y: 80 },
            width: 560,
            height: 320,
          },
          {
            id: EXPANSION_PEER,
            title: 'Occupied workspace',
            kind: 'note',
            task: { text: 'Keep this window and its content intact.' },
            position: { x: 760, y: 80 },
            width: 340,
            height: 260,
          },
        ],
      },
    ],
  })
  await expect(page.locator(`[data-id="${EXPANSION_TERMINAL}"] .xterm`)).toBeVisible()
  await expect.poll(() => readTerminalIdentity(page)).toMatchObject({ ready: true })
  await page.locator('.react-flow__controls-fitview').click()
}

export async function readNodeFrame(page: Page, id: string): Promise<NodeFrame> {
  return page.locator(`.react-flow__node[data-id="${id}"]`).evaluate(element => {
    const node = element as HTMLElement
    const transform = new DOMMatrixReadOnly(node.style.transform)
    return { x: transform.e, y: transform.f, width: node.offsetWidth, height: node.offsetHeight }
  })
}

export async function readTerminalIdentity(page: Page) {
  return page.evaluate(id => {
    const api = window.__opencoveTerminalSelectionTestApi
    const body = document.querySelector<HTMLElement>(`[data-id="${id}"] .terminal-node__terminal`)
    const sessionId = api?.getRuntimeSessionId(id) ?? null
    const size = api?.getSize(id) ?? null
    const proposed = api?.getProposedGeometry(id) ?? null
    return {
      ready: Boolean(
        sessionId && size && proposed && size.cols === proposed.cols && size.rows === proposed.rows,
      ),
      sessionId,
      instanceId: api?.getRenderMetrics(id)?.instanceId ?? null,
      size,
      body: body ? { width: body.clientWidth, height: body.clientHeight } : null,
    }
  }, EXPANSION_TERMINAL)
}

export async function readPersistedFrame(page: Page, id: string) {
  return page.evaluate(
    async ({ projectId, nodeId }) => {
      const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
      const state = raw
        ? (JSON.parse(raw) as {
            workspaces?: Array<{
              id: string
              nodes?: Array<{
                id: string
                width: number
                height: number
                position: { x: number; y: number }
              }>
            }>
          })
        : null
      const node = state?.workspaces
        ?.find(workspace => workspace.id === projectId)
        ?.nodes?.find(item => item.id === nodeId)
      return node
        ? { x: node.position.x, y: node.position.y, width: node.width, height: node.height }
        : null
    },
    { projectId: EXPANSION_PROJECT, nodeId: id },
  )
}

export async function writeCollapsedTerminalMarker(
  page: Page,
  sessionId: string,
  phase: 'collapsed' | 'expanded' = 'collapsed',
) {
  const markerParts = ['EXPANSION', phase.toUpperCase(), 'ALIVE']
  const command = buildNodeEvalCommand(
    `process.stdout.write(${JSON.stringify(markerParts)}.join('_') + '\\n')`,
  )
  await page.evaluate(
    async ({ sessionId: id, command: input }) => {
      await window.opencoveApi.pty.write({ sessionId: id, data: `${input}\r` })
    },
    { sessionId, command },
  )
  await expect
    .poll(() =>
      page.evaluate(async id => {
        return (await window.opencoveApi.pty.presentationSnapshot({ sessionId: id }))
          .serializedScreen
      }, sessionId),
    )
    .toContain(markerParts.join('_'))
}

export async function sampleCollapsedDrag(page: Page): Promise<DragFrame[]> {
  const nodeLocator = page.locator(`.react-flow__node[data-id="${EXPANSION_TERMINAL}"]`)
  const compact = page.getByTestId(`collapsed-node-${EXPANSION_TERMINAL}`)
  await compact.getByTestId('node-expand').click({ modifiers: ['Shift'] })
  await expect(nodeLocator).toHaveClass(/selected/)
  await expect(page.locator('.react-flow__nodesselection-rect')).toBeVisible()
  const before = await readLocatorClientRect(nodeLocator)
  const peer = await readLocatorClientRect(
    page.locator(`.react-flow__node[data-id="${EXPANSION_PEER}"]`),
  )
  const pointerZoom = before.width / 112
  const start = { x: before.x + before.width / 2, y: before.y + 30 * pointerZoom }
  const end = { x: peer.x - 24 * pointerZoom - before.width / 2, y: peer.y + 30 * pointerZoom }
  await page.evaluate(id => {
    const host = window as ProbeWindow
    const samples: DragFrame[] = []
    const probe: DragProbe = { samples, frameId: 0, active: true }
    host.__opencoveCollapseExpansionProbe = probe
    const sample = () => {
      if (!probe.active) {
        return
      }
      const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)
      const selection = document.querySelector<HTMLElement>('.react-flow__nodesselection-rect')
      const runtime = node?.querySelector<HTMLElement>('.terminal-node__terminal')
      const viewport = document.querySelector('.react-flow__viewport')
      if (node && runtime && viewport) {
        const zoom = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a
        const frame = (element: HTMLElement): NodeFrame => {
          const rect = element.getBoundingClientRect()
          return { x: rect.x, y: rect.y, width: rect.width / zoom, height: rect.height / zoom }
        }
        samples.push({
          node: frame(node),
          selection: selection ? frame(selection) : null,
          runtime: { width: runtime.clientWidth, height: runtime.clientHeight },
        })
      }
      probe.frameId = requestAnimationFrame(sample)
    }
    probe.frameId = requestAnimationFrame(sample)
  }, EXPANSION_TERMINAL)
  let dragSamples: DragFrame[] = []
  try {
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    for (let step = 1; step <= 24; step += 1) {
      await page.mouse.move(
        start.x + ((end.x - start.x) * step) / 24,
        start.y + ((end.y - start.y) * step) / 24,
      )
      await page.evaluate(
        () => new Promise<void>(resolve => requestAnimationFrame(() => resolve())),
      )
    }
    await page.mouse.up()
    await page.evaluate(
      () =>
        new Promise<void>(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    )
  } finally {
    await page.mouse.up()
    dragSamples = await page.evaluate(() => {
      const host = window as ProbeWindow
      const probe = host.__opencoveCollapseExpansionProbe
      if (!probe) {
        throw new Error('Collapsed drag probe is missing')
      }
      probe.active = false
      cancelAnimationFrame(probe.frameId)
      delete host.__opencoveCollapseExpansionProbe
      return probe.samples
    })
  }
  return dragSamples
}

export function framesOverlap(left: NodeFrame, right: NodeFrame): boolean {
  return (
    left.x < right.x + right.width - 1 &&
    right.x < left.x + left.width - 1 &&
    left.y < right.y + right.height - 1 &&
    right.y < left.y + left.height - 1
  )
}
