import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'
import type {} from '../../src/contexts/workspace/presentation/renderer/components/terminalNode/testHarness'

async function readState(page: Page, nodeId: string) {
  return page.evaluate(async id => {
    const api = window.__opencoveTerminalSelectionTestApi!
    await api.flushOutput(id)
    return {
      modes: api.getEmulationState(id),
      lines: api.getBufferText(id, 'STATE_HISTORY_01')?.viewportLines ?? [],
      instanceId: api.getRenderMetrics(id)?.instanceId,
      writes: api.getOutputWrites(id),
      sessionId: api.getRuntimeSessionId(id),
    }
  }, nodeId)
}

test.describe('Agent terminal state restore', () => {
  for (const path of ['renderer reload', 'workspace switch'] as const) {
    test(`restores alternate screen, input modes and multiline paste after ${path}`, async ({
      browserName: _browserName,
    }, testInfo) => {
      const { electronApp, window: page } = await launchApp({
        env: {
          OPENCOVE_TEST_USE_REAL_AGENTS: '0',
          OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'raw-agent-terminal-state-restore',
        },
      })
      let sessionId: string | null = null
      try {
        await clearAndSeedWorkspace(page, [], { settings: { defaultProvider: 'codex' } })
        const originalProject = await page
          .locator('.workspace-item')
          .first()
          .getAttribute('data-testid')
        const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'))
        const otherPath = join(userData, 'other-project')
        await mkdir(otherPath, { recursive: true })
        const other = await page.evaluate(
          async directory =>
            window.opencoveApi.controlSurface.invoke<{ projectId: string }>({
              kind: 'command',
              id: 'project.add',
              payload: { path: directory, name: 'State restore other' },
            }),
          otherPath,
        )
        await page.getByTestId(originalProject!).click()
        await page
          .locator('.workspace-canvas .react-flow__pane')
          .click({ button: 'right', position: { x: 320, y: 220 } })
        await page.getByTestId('workspace-context-run-default-agent').click()
        await expect(page.locator('.terminal-node')).toHaveCount(1)
        await expect
          .poll(() =>
            page.evaluate(
              () => window.__opencoveTerminalSelectionTestApi?.getRegisteredNodeIds()[0] ?? null,
            ),
          )
          .not.toBeNull()
        const nodeId = await page.evaluate(
          () => window.__opencoveTerminalSelectionTestApi!.getRegisteredNodeIds()[0]!,
        )
        sessionId = await page.evaluate(
          id => window.__opencoveTerminalSelectionTestApi!.getRuntimeSessionId(id),
          nodeId,
        )
        await expect
          .poll(async () => (await readState(page, nodeId!)).lines.join('\n'))
          .toContain('STATE_HISTORY_08')
        await expect(
          page.locator(`.react-flow__node[data-id="${nodeId}"] .terminal-node__terminal`),
        ).toHaveAttribute('aria-busy', 'false')
        const before = await readState(page, nodeId!)
        sessionId = before.sessionId
        expect(before.modes).toMatchObject({
          bufferKind: 'alternate',
          bracketedPasteMode: true,
          mouseTrackingMode: 'any',
          mouseEncoding: 'SGR',
          applicationCursorKeysMode: true,
          applicationKeypadMode: true,
          sendFocusMode: true,
          originMode: false,
          wraparoundMode: true,
          cursorVisible: false,
        })
        // Hold accepted snapshots AFTER capture: periodic EL writes are guaranteed
        // to be fresh, and the final post-geometry snapshot must also survive them.
        await electronApp.evaluate(({ ipcMain }) => {
          const handlers = (
            ipcMain as typeof ipcMain & {
              _invokeHandlers: Map<string, (...args: unknown[]) => unknown>
            }
          )._invokeHandlers
          const channel = 'pty:presentation-snapshot'
          const original = handlers.get(channel)!
          const state = ipcMain as typeof ipcMain & { stateRestoreDeliveredSnapshots: number }
          state.stateRestoreDeliveredSnapshots = 0
          handlers.set(channel, async (...args) => {
            const snapshot = await original(...args)
            await new Promise(resolve => setTimeout(resolve, 300))
            state.stateRestoreDeliveredSnapshots += 1
            return snapshot
          })
        })
        const triggeredAt = Date.now()
        if (path === 'renderer reload') {
          await page.reload({ waitUntil: 'domcontentloaded' })
        } else {
          await page.getByTestId(`workspace-item-${other.projectId}`).click()
          await expect(page.locator('.terminal-node')).toHaveCount(0)
          await page.getByTestId(originalProject!).click()
        }
        await expect(page.locator('.terminal-node')).toHaveCount(1)
        await expect
          .poll(
            () =>
              electronApp.evaluate(
                ({ ipcMain }) =>
                  (ipcMain as typeof ipcMain & { stateRestoreDeliveredSnapshots: number })
                    .stateRestoreDeliveredSnapshots,
              ),
            { timeout: 30_000 },
          )
          .toBeGreaterThanOrEqual(2)
        await expect(
          page.locator(`.react-flow__node[data-id="${nodeId}"] .terminal-node__terminal`),
        ).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
        const after = await readState(page, nodeId!)
        await testInfo.attach('restored-terminal-state', {
          body: Buffer.from(JSON.stringify({ before, after })),
          contentType: 'application/json',
        })
        expect(after.modes).toEqual(before.modes)
        expect(after.sessionId).toBe(before.sessionId)
        if (path === 'workspace switch') {
          expect(after.instanceId).not.toBe(before.instanceId)
        }
        for (let i = 1; i <= 8; i += 1) {
          expect(after.lines.join('\n')).toContain(`STATE_HISTORY_${String(i).padStart(2, '0')}`)
        }
        expect(
          after.writes.filter(record => record.at >= triggeredAt && record.containsRIS),
        ).toEqual([])
        await page.locator('.terminal-node .xterm-helper-textarea').focus()
        const text = 'first line\nsecond line'
        // A real DOM paste travels through xterm's clipboard handler, onData and
        // the PTY. The stub reports the actual received delimiter bytes as JSON.
        await page.locator('.terminal-node .xterm-helper-textarea').evaluate((element, value) => {
          const data = new DataTransfer()
          data.setData('text/plain', value)
          element.dispatchEvent(
            new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
          )
        }, text)
        const expected = `STATE_PASTE ${JSON.stringify('\x1b[200~first line\rsecond line\x1b[201~')}`
        await expect
          .poll(async () => (await readState(page, nodeId!)).lines.join('\n'))
          .toContain(expected)
        const final = await readState(page, nodeId!)
        expect(final.modes).toEqual(before.modes)
        await testInfo.attach('terminal-state', {
          body: Buffer.from(JSON.stringify({ before, after, final })),
          contentType: 'application/json',
        })
      } finally {
        if (sessionId && !page.isClosed()) {
          await page
            .evaluate(id => window.opencoveApi.pty.kill({ sessionId: id }), sessionId)
            .catch(() => undefined)
        }
        await electronApp.close()
      }
    })
  }
})
