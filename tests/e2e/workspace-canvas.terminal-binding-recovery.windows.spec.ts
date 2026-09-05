import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, readLocatorClientRect } from './workspace-canvas.helpers'

for (const uiTheme of ['dark', 'light'] as const) {
  test(`Windows recovered terminals publish their binding and accept fresh input (${uiTheme})`, async () => {
    test.skip(process.platform !== 'win32', 'Windows terminal recovery')
    const { electronApp, window } = await launchApp({
      deviceScaleFactor: 1.5,
      env: { OPENCOVE_WORKER_CLIENT: '1' },
    })
    const nodeId = 'binding-recovery'
    const terminal = window.locator(`[data-id="${nodeId}"] .terminal-node`)
    const runtimeId = () =>
      window.evaluate(
        id => window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(id),
        nodeId,
      )
    try {
      await clearAndSeedWorkspace(
        window,
        [{ id: nodeId, title: nodeId, position: { x: 80, y: 80 }, width: 560, height: 380 }],
        { settings: { uiTheme, terminalDisplayAutoReferenceEnabled: false } },
      )
      await expect.poll(runtimeId).toBeTruthy()
      const oldSessionId = (await runtimeId())!
      await window.evaluate(async sessionId => {
        await window.opencoveApi.pty.kill({ sessionId })
      }, oldSessionId)
      const resizer = await readLocatorClientRect(terminal.getByTestId('terminal-resizer-right'))
      await window.mouse.move(resizer.x + resizer.width / 2, resizer.y + resizer.height / 2)
      await window.mouse.down()
      await window.mouse.move(resizer.x + 90, resizer.y + resizer.height / 2, { steps: 8 })
      await window.mouse.up()
      const feedback = terminal.getByTestId('terminal-geometry-feedback')
      await expect(feedback).toBeVisible()
      const warningRect = await readLocatorClientRect(feedback)
      const bodyRect = await readLocatorClientRect(terminal.locator('.terminal-node__body'))
      expect(bodyRect.y).toBeGreaterThanOrEqual(warningRect.y + warningRect.height - 1)
      await test.info().attach('geometry-warning-above-content', {
        body: await terminal.screenshot(),
        contentType: 'image/png',
      })
      await expect
        .poll(() =>
          window.evaluate(async sessionId => {
            const result = await window.opencoveApi.controlSurface.invoke<{
              sessions: Array<{ sessionId: string; status: string }>
            }>({ kind: 'query', id: 'session.list', payload: {} })
            return result.sessions.find(session => session.sessionId === sessionId)?.status
          }, oldSessionId),
        )
        .toBe('exited')
      await window.reload({ waitUntil: 'domcontentloaded' })
      await expect.poll(runtimeId).toBeTruthy()
      await expect.poll(runtimeId).not.toBe(oldSessionId)
      const recoveredSessionId = (await runtimeId())!
      await expect
        .poll(() =>
          window.evaluate(async id => {
            const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
            const state = JSON.parse(raw!)
            return state.workspaces
              .flatMap(
                (workspace: { nodes: Array<{ id: string; sessionId: string }> }) => workspace.nodes,
              )
              .find((node: { id: string }) => node.id === id)?.sessionId
          }, nodeId),
        )
        .toBe(recoveredSessionId)
      await window.reload({ waitUntil: 'domcontentloaded' })
      await expect.poll(runtimeId).toBe(recoveredSessionId)
      await expect(terminal.locator('.xterm')).toBeVisible()
      const marker = `RECOVERED_${Date.now().toString(36)}`
      await terminal.locator('.xterm-helper-textarea').focus()
      await window.keyboard.type(`Write-Output ('${marker}' + '_INPUT_OK')`)
      await window.keyboard.press('Enter')
      await expect
        .poll(() =>
          window.evaluate(
            async ({ nodeId: targetNodeId, sessionId, marker: outputMarker }) => {
              const api = window.__opencoveTerminalSelectionTestApi!
              const snapshot = await window.opencoveApi.pty.presentationSnapshot({ sessionId })
              const grid = api.getSize(targetNodeId)
              const proposed = api.getProposedGeometry(targetNodeId)
              return (
                api
                  .getBufferText(targetNodeId, '')
                  .viewportLines.some(line => line === `${outputMarker}_INPUT_OK`) &&
                snapshot.serializedScreen.includes(`${outputMarker}_INPUT_OK`) &&
                grid?.cols === snapshot.cols &&
                grid?.rows === snapshot.rows &&
                grid?.cols === proposed?.cols &&
                grid?.rows === proposed?.rows
              )
            },
            { nodeId, sessionId: recoveredSessionId, marker },
          ),
        )
        .toBe(true)
      await expect(terminal.getByTestId('terminal-geometry-feedback')).toHaveCount(0)
      await test.info().attach('recovered-terminal-input', {
        body: await terminal.screenshot(),
        contentType: 'image/png',
      })
    } finally {
      await electronApp.close()
    }
  })
}
