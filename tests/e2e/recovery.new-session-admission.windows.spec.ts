import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import {
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  seedWorkspaceState,
  testWorkspacePath,
} from './workspace-canvas.helpers'

type RecoveryGate = { blocked: boolean; release: () => void; original: typeof fetch }
type GateGlobal = typeof globalThis & { __opencoveStartupRecoveryGate?: RecoveryGate }

async function releaseRecovery(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const state = (globalThis as GateGlobal).__opencoveStartupRecoveryGate
    if (state) {
      globalThis.fetch = state.original
      state.release()
    }
  })
}

async function openCanvasMenu(window: Page): Promise<void> {
  const pane = window.locator('.workspace-canvas .react-flow__pane')
  const position = await pane.evaluate(element => {
    const rect = element.getBoundingClientRect()
    for (let y = 100; y < rect.height - 40; y += 100) {
      for (let x = 100; x < rect.width - 40; x += 100) {
        if (document.elementFromPoint(rect.x + x, rect.y + y) === element) {
          return { x, y }
        }
      }
    }
    throw new Error('No uncovered canvas point available')
  })
  await pane.click({ button: 'right', position })
}

test('creates interactive terminal and Agent sessions before cold recovery completes', async () => {
  test.skip(process.platform !== 'win32', 'Windows cold startup with real PTYs')
  const userDataDir = await createTestUserDataDir()
  const env = { OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'stdin-echo' }
  let app: ElectronApplication | null = null
  try {
    const initial = await launchApp({ userDataDir, cleanupUserDataDir: false, env })
    app = initial.electronApp
    // An empty initial workspace lets the test hold recovery before selecting the persisted one,
    // without racing the app's first paint or adding a production startup-delay hook.
    await seedWorkspaceState(initial.window, {
      activeWorkspaceId: 'boot-workspace',
      settings: {
        defaultProvider: 'codex',
        customModelEnabledByProvider: { codex: true },
        customModelByProvider: { codex: 'test-model' },
        customModelOptionsByProvider: { codex: ['test-model'] },
        terminalDisplayAutoReferenceEnabled: false,
      },
      workspaces: [
        { id: 'boot-workspace', name: 'Boot workspace', path: testWorkspacePath, nodes: [] },
        {
          id: 'recovering-workspace',
          name: 'Recovering workspace',
          path: testWorkspacePath,
          nodes: [
            {
              id: 'slow-restore',
              title: 'Old terminal',
              position: { x: 40, y: 40 },
              width: 420,
              height: 280,
              scrollback: 'OLD_TERMINAL_HISTORY\r\n',
            },
          ],
        },
      ],
    })
    await app.close()
    app = null

    const restarted = await launchApp({ userDataDir, cleanupUserDataDir: false, env })
    app = restarted.electronApp
    const window = restarted.window
    await expect(window.locator('.workspace-item')).toHaveCount(2)
    await app.evaluate(() => {
      const original = globalThis.fetch
      let release!: () => void
      const gate = new Promise<void>(resolve => {
        release = resolve
      })
      const state = { blocked: false, release, original }
      ;(globalThis as GateGlobal).__opencoveStartupRecoveryGate = state
      globalThis.fetch = async (input, init) => {
        if (typeof init?.body === 'string') {
          const request = JSON.parse(init.body)
          if (
            request.id === 'session.prepareOrRevive' &&
            request.payload.workspaceId === 'recovering-workspace'
          ) {
            state.blocked = true
            await gate
          }
        }
        return original(input, init)
      }
    })
    await window.locator('.workspace-item').filter({ hasText: 'Recovering workspace' }).click()
    const recoveryBlocked = () =>
      app!.evaluate(() => (globalThis as GateGlobal).__opencoveStartupRecoveryGate?.blocked)
    await expect.poll(recoveryBlocked).toBe(true)
    const oldSession = () =>
      window.evaluate(() =>
        window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId('slow-restore'),
      )
    expect(await oldSession()).toBeNull()

    const creationStartedAt = Date.now()
    await openCanvasMenu(window)
    await window.getByTestId('workspace-context-new-terminal').click()
    await expect(window.locator('.terminal-node')).toHaveCount(2)
    const terminal = window.locator(
      '.react-flow__node:not([data-id="slow-restore"]) .terminal-node',
    )
    await expect(terminal.locator('.terminal-node__terminal')).toHaveAttribute('aria-busy', 'false')
    await terminal.locator('.xterm-helper-textarea').focus()
    await window.keyboard.type("Write-Output ('NEW_TERMINAL_' + 'INPUT_OK')")
    await window.keyboard.press('Enter')
    await expect(terminal).toContainText('NEW_TERMINAL_INPUT_OK')
    const terminalReadyMs = Date.now() - creationStartedAt

    await openCanvasMenu(window)
    await window.getByTestId('workspace-context-run-default-agent').click()
    await expect(window.locator('.terminal-node')).toHaveCount(3)
    const agent = window
      .locator('.terminal-node')
      .filter({ has: window.locator('.terminal-node__status') })
    await expect(agent.locator('.terminal-node__terminal')).toHaveAttribute('aria-busy', 'false')
    await agent.locator('.xterm-helper-textarea').focus()
    await window.keyboard.press('Enter')
    await expect(agent).toContainText(/stdin_hex=(0d0a|0d|0a)/)
    expect(await oldSession()).toBeNull()
    await test.info().attach('creation-before-recovery-timing', {
      body: JSON.stringify({ terminalReadyMs, bothReadyMs: Date.now() - creationStartedAt }),
      contentType: 'application/json',
    })
    await test.info().attach('interactive-sessions-with-pending-recovery', {
      body: await window.screenshot({ path: test.info().outputPath('startup-new-sessions.png') }),
      contentType: 'image/png',
    })

    await releaseRecovery(app)
    await expect.poll(oldSession).toBeTruthy()
    await expect(window.locator('[data-id="slow-restore"] .terminal-node')).toContainText(
      'OLD_TERMINAL_HISTORY',
    )
    const readBindings = () =>
      window.evaluate(async () => {
        const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
        const state = JSON.parse(raw!) as {
          workspaces: Array<{ id: string; nodes: Array<{ id: string; sessionId?: string }> }>
        }
        return state.workspaces
          .find(workspace => workspace.id === 'recovering-workspace')!
          .nodes.map(node => ({ id: node.id, sessionId: node.sessionId ?? '' }))
          .sort((a, b) => a.id.localeCompare(b.id))
      })
    await expect
      .poll(async () => {
        const bindings = await readBindings()
        return bindings.length === 3 && bindings.every(node => node.sessionId.length > 0)
      })
      .toBe(true)
    const bindings = await readBindings()
    await window.reload({ waitUntil: 'domcontentloaded' })
    await expect(window.locator('.terminal-node')).toHaveCount(3)
    await expect.poll(readBindings).toEqual(bindings)
    await expect
      .poll(() =>
        window.evaluate(
          nodes =>
            nodes.every(
              node =>
                window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(node.id) ===
                node.sessionId,
            ),
          bindings,
        ),
      )
      .toBe(true)
  } finally {
    if (app) {
      await releaseRecovery(app).catch(() => undefined)
      await app.close()
    }
    await removePathWithRetry(userDataDir)
  }
})
