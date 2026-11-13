import { expect, test } from '@playwright/test'
import { buildNodeEvalCommand, clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

test('WebGL loss preserves the live terminal buffer, selection and scrolled viewport', async () => {
  const { electronApp, window } = await launchApp({ windowMode: 'inactive' })
  const nodeId = 'context-loss-continuity'
  const marker = 'CONTEXT_LOSS_READY'
  try {
    await clearAndSeedWorkspace(window, [
      { id: nodeId, title: nodeId, position: { x: 40, y: 40 }, width: 720, height: 480 },
    ])
    const surface = window.locator(`[data-id="${nodeId}"] .terminal-node__terminal`)
    // Hydration finishes after renderer selection; a startup DOM placeholder is not a fallback.
    await expect(surface).toHaveAttribute('aria-busy', 'false')
    await expect(surface).toHaveAttribute('data-cove-terminal-renderer', /^(webgl|dom)$/)
    // Skip only where the runner has no WebGL2 at all (software-GL xvfb). Where WebGL2 exists, a
    // DOM terminal is a renderer regression and must fail rather than skip.
    const webgl2Available = await window.evaluate(() => {
      const probe = document.createElement('canvas').getContext('webgl2')
      probe?.getExtension('WEBGL_lose_context')?.loseContext()
      return probe !== null
    })
    test.info().annotations.push({ type: 'webgl2-available', description: String(webgl2Available) })
    test.skip(!webgl2Available, 'WebGL context loss needs a runner with WebGL2')
    await expect(surface).toHaveAttribute('data-cove-terminal-renderer', 'webgl')
    await surface.locator('.xterm-helper-textarea').focus()
    // Keep the producer alive and quiet after READY, so the snapshot has no prompt/output race.
    await window.keyboard.type(
      buildNodeEvalCommand(
        `for(let i=0;i<70;i++)console.log('history-'+i);console.log('${marker}');process.stdin.once('data',()=>{console.log('CONTEXT_LOSS_INPUT_OK');process.exit(0)})`,
      ),
    )
    await window.keyboard.press('Enter')
    await expect
      .poll(() =>
        window.evaluate(
          ({ id, marker: text }) =>
            window.__opencoveTerminalSelectionTestApi?.getBufferText(id, text)?.markerAbsoluteLine,
          { id: nodeId, marker },
        ),
      )
      .toBeGreaterThan(0)
    await window.evaluate(async id => {
      const api = window.__opencoveTerminalSelectionTestApi!
      await api.flushOutput(id)
      api.scrollToLine(id, Math.max(0, api.getRenderMetrics(id)!.baseY! - 5))
      api.selectAll(id)
    }, nodeId)
    const readState = () =>
      window.evaluate(
        ({ id, marker: text }) => {
          const api = window.__opencoveTerminalSelectionTestApi!
          const metrics = api.getRenderMetrics(id)!
          return {
            instanceId: metrics.instanceId,
            baseY: metrics.baseY,
            viewportY: metrics.viewportY,
            buffer: api.getBufferText(id, text),
            selection: api.getSelection(id),
            size: api.getSize(id),
            sessionId: api.getRuntimeSessionId(id),
          }
        },
        { id: nodeId, marker },
      )
    const before = await readState()
    expect(before.viewportY).toBeLessThan(before.baseY!)
    expect(before.selection).toContain(marker)
    await surface.locator('.xterm-screen > canvas:not([class])').evaluate(canvas => {
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    })
    await expect(surface).toHaveAttribute('data-cove-terminal-renderer', 'dom')
    await expect(surface.locator('.xterm-rows')).toContainText('history-')
    const after = await readState()
    await test.info().attach('context-loss-continuity', {
      body: Buffer.from(JSON.stringify({ before, after })),
      contentType: 'application/json',
    })
    expect(after).toEqual(before)
    await window.evaluate(id => {
      const api = window.__opencoveTerminalSelectionTestApi!
      api.clearSelection(id)
      api.scrollToBottom(id)
    }, nodeId)
    await surface.locator('.xterm-helper-textarea').focus()
    await window.keyboard.type('continue')
    await window.keyboard.press('Enter')
    await expect(surface.locator('.xterm-rows')).toContainText('CONTEXT_LOSS_INPUT_OK')
    await test.info().attach('dom-fallback-after-input', {
      body: await surface.screenshot(),
      contentType: 'image/png',
    })
  } finally {
    await electronApp.close()
  }
})
