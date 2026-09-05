import { expect, test } from '@playwright/test'
import { buildNodeEvalCommand, clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

test('keeps a restored terminal interactive while a sibling recovery request is blocked', async () => {
  test.skip(process.platform !== 'win32', 'Windows real PowerShell recovery')
  const { electronApp, window } = await launchApp({ deviceScaleFactor: 1.5 })
  const ids = ['slow-restore', 'fast-restore']
  try {
    await clearAndSeedWorkspace(
      window,
      ids.map((id, index) => ({
        id,
        title: id,
        position: { x: 50 + index * 550, y: 80 },
        width: 520,
        height: 340,
      })),
    )
    const readSession = (id: string) =>
      window.evaluate(
        nodeId => window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(nodeId),
        id,
      )
    await expect
      .poll(async () => (await Promise.all(ids.map(readSession))).every(Boolean))
      .toBe(true)
    const sessions = await Promise.all(ids.map(readSession))
    await expect
      .poll(() =>
        window.evaluate(async nodeIds => {
          const state = JSON.parse((await window.opencoveApi.persistence.readWorkspaceStateRaw())!)
          return nodeIds.every(id =>
            state.workspaces.some((w: { nodes: Array<{ id: string; sessionId?: string }> }) =>
              w.nodes.some(n => n.id === id && Boolean(n.sessionId)),
            ),
          )
        }, ids),
      )
      .toBe(true)

    // Block only the slow node at the real Main -> Worker HTTP boundary. Every PTY remains real.
    await electronApp.evaluate(() => {
      const original = globalThis.fetch
      let release!: () => void
      const gate = new Promise<void>(resolve => {
        release = resolve
      })
      const state = { blocked: false, release, original }
      Object.assign(globalThis, { __opencoveRecoveryGate: state })
      globalThis.fetch = async (input, init) => {
        if (typeof init?.body === 'string') {
          const request = JSON.parse(init.body)
          if (
            request.id === 'session.prepareOrRevive' &&
            request.payload.nodeIds.includes('slow-restore')
          ) {
            state.blocked = true
            await gate
          }
        }
        return original(input, init)
      }
    })
    await window.reload({ waitUntil: 'domcontentloaded' })
    await expect
      .poll(() =>
        electronApp.evaluate(
          () =>
            (globalThis as unknown as { __opencoveRecoveryGate: { blocked: boolean } })
              .__opencoveRecoveryGate.blocked,
        ),
      )
      .toBe(true)
    await expect.poll(() => readSession('fast-restore'), { timeout: 10_000 }).toBe(sessions[1])
    expect(await readSession('slow-restore')).toBeNull()
    const fastTerminal = window.locator('[data-id="fast-restore"] .terminal-node')
    await fastTerminal.locator('.xterm-helper-textarea').focus()
    await window.keyboard.type(buildNodeEvalCommand("process.stdout.write('FAST_'+'INPUT_OK\\n')"))
    await window.keyboard.press('Enter')
    await expect
      .poll(() =>
        window.evaluate(
          () =>
            window.__opencoveTerminalSelectionTestApi?.getBufferText(
              'fast-restore',
              'FAST_INPUT_OK',
            )?.markerAbsoluteLine,
        ),
      )
      .toBeGreaterThanOrEqual(0)
    await test.info().attach('ready-terminal-with-pending-sibling', {
      body: await fastTerminal.screenshot(),
      contentType: 'image/png',
    })
    await electronApp.evaluate(() => {
      const state = (
        globalThis as unknown as {
          __opencoveRecoveryGate: { release: () => void; original: typeof fetch }
        }
      ).__opencoveRecoveryGate
      globalThis.fetch = state.original
      state.release()
    })
    await expect.poll(() => readSession('slow-restore')).toBe(sessions[0])
    await window.reload({ waitUntil: 'domcontentloaded' })
    await expect.poll(() => Promise.all(ids.map(readSession))).toEqual(sessions)
  } finally {
    await electronApp
      .evaluate(() => {
        const state = (
          globalThis as unknown as {
            __opencoveRecoveryGate?: { release: () => void; original: typeof fetch }
          }
        ).__opencoveRecoveryGate
        if (state) {
          globalThis.fetch = state.original
          state.release()
        }
      })
      .catch(() => undefined)
    await electronApp.close()
  }
})
