import { expect, test } from '@playwright/test'
import {
  buildAppState,
  createWorkspaceDir,
  openAuthedCanvas,
  readSharedState,
  writeAppState,
} from './helpers'

test('a live Web terminal reattach reconciles with its current node frame', async ({ page }) => {
  const workspacePath = await createWorkspaceDir('web-live-geometry')
  await writeAppState(
    page.request,
    buildAppState({ workspacePath, workspaceName: 'web-live-geometry', spaces: [] }),
  )
  await openAuthedCanvas(page)
  await page.goto('/?opencoveTerminalTestApi=1', { waitUntil: 'domcontentloaded' })

  const pane = page.locator('.workspace-canvas .react-flow__pane')
  await expect(pane).toBeVisible()
  await pane.click({ button: 'right', position: { x: 260, y: 220 } })
  await page.locator('[data-testid="workspace-context-new-terminal"]').click()
  await expect(page.locator('.terminal-node')).toHaveCount(1)

  const sharedBefore = await readSharedState(page.request)
  const terminalNode = sharedBefore.state?.workspaces[0]?.nodes.find(
    node => node.kind === 'terminal',
  )
  if (!terminalNode || typeof terminalNode.id !== 'string') {
    throw new Error('Missing persisted Web terminal node')
  }
  const nodeId = terminalNode.id
  await expect
    .poll(
      async () =>
        await page.evaluate(
          id => window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(id) ?? null,
          nodeId,
        ),
    )
    .toBeTruthy()
  await expect
    .poll(
      async () =>
        await page.evaluate(id => {
          const api = window.__opencoveTerminalSelectionTestApi
          const size = api?.getSize(id) ?? null
          const proposed = api?.getProposedGeometry(id) ?? null
          return Boolean(
            size && proposed && size.cols === proposed.cols && size.rows === proposed.rows,
          )
        }, nodeId),
    )
    .toBe(true)

  const before = await page.evaluate(
    id => ({
      sessionId: window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(id) ?? null,
      size: window.__opencoveTerminalSelectionTestApi?.getSize(id) ?? null,
    }),
    nodeId,
  )
  expect(before.sessionId).toBeTruthy()
  const historyMarker = `WEB_HISTORY_${Date.now()}`
  const terminal = page.locator('.terminal-node').first()
  await terminal.locator('.xterm').click()
  await page.keyboard.type(`printf '${historyMarker}\\n'`)
  await page.keyboard.press('Enter')
  await expect(terminal).toContainText(historyMarker)

  const completeState = sharedBefore.state as unknown as {
    activeWorkspaceId: string | null
    workspaces: Array<{ nodes: Array<Record<string, unknown>> }>
  }
  const persistedNode = completeState.workspaces
    .flatMap(workspace => workspace.nodes)
    .find(node => node.id === nodeId)
  if (!persistedNode) {
    throw new Error('Missing complete terminal node')
  }
  persistedNode.width = Number(persistedNode.width ?? 0) + 340
  persistedNode.height = Number(persistedNode.height ?? 0) + 240
  await writeAppState(page.request, completeState)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('.terminal-node')).toHaveCount(1)
  await expect
    .poll(
      async () =>
        await page.evaluate(
          id => window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(id) ?? null,
          nodeId,
        ),
    )
    .toBe(before.sessionId)
  await expect(page.locator('.terminal-node')).toContainText(historyMarker)
  await expect
    .poll(
      async () =>
        await page.evaluate(id => {
          const api = window.__opencoveTerminalSelectionTestApi
          const size = api?.getSize(id) ?? null
          const proposed = api?.getProposedGeometry(id) ?? null
          return Boolean(
            size && proposed && size.cols === proposed.cols && size.rows === proposed.rows,
          )
        }, nodeId),
    )
    .toBe(true)

  const after = await page.evaluate(
    id => ({
      sessionId: window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(id) ?? null,
      size: window.__opencoveTerminalSelectionTestApi?.getSize(id) ?? null,
      proposed: window.__opencoveTerminalSelectionTestApi?.getProposedGeometry(id) ?? null,
    }),
    nodeId,
  )
  expect(after.proposed).not.toEqual(before.size)
  expect(after.size).toEqual(after.proposed)
  const snapshot = await page.evaluate(
    async sessionId =>
      sessionId ? await window.opencoveApi.pty.presentationSnapshot({ sessionId }) : null,
    after.sessionId,
  )
  expect(snapshot).toMatchObject({ cols: after.size?.cols, rows: after.size?.rows })
})
