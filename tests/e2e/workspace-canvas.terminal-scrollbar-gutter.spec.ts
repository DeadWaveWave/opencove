import { expect, test, type Locator } from '@playwright/test'
import {
  buildEchoSequenceCommand,
  clearAndSeedWorkspace,
  launchApp,
  testWorkspacePath,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Terminal scrollbar gutter', () => {
  test('removes xterm native scrollbar + black viewport background (terminal + agent)', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'node-a',
            title: 'terminal-a',
            position: { x: 180, y: 140 },
            width: 520,
            height: 320,
          },
          {
            id: 'node-b',
            title: 'codex · gpt-5.2-codex',
            position: { x: 760, y: 140 },
            width: 520,
            height: 320,
            kind: 'agent',
            status: 'running',
            startedAt: '2026-02-09T00:00:00.000Z',
            endedAt: null,
            exitCode: null,
            lastError: null,
            agent: {
              provider: 'codex',
              prompt: 'hydrate agent terminal chrome',
              model: 'gpt-5.2-codex',
              effectiveModel: 'gpt-5.2-codex',
              launchMode: 'new',
              resumeSessionId: null,
              resumeSessionIdVerified: false,
              executionDirectory: testWorkspacePath,
              expectedDirectory: testWorkspacePath,
              directoryMode: 'workspace',
              customDirectory: null,
              shouldCreateDirectory: false,
            },
          },
        ],
        {
          settings: {
            uiTheme: 'light',
            terminalFontSize: 13,
          },
        },
      )

      await expect
        .poll(() =>
          window.evaluate(() => {
            return document.documentElement.dataset.coveTheme ?? null
          }),
        )
        .toBe('light')

      const nodes = window.locator('.terminal-node')
      await expect(nodes).toHaveCount(2)
      await expect(nodes.nth(0).locator('.xterm')).toBeVisible()
      await expect(nodes.nth(1).locator('.xterm')).toBeVisible()

      const assertTerminalSurface = async (nodeId: string, node: Locator) => {
        const xterm = node.locator('.xterm')
        await xterm.click()
        await expect(node.locator('.xterm-helper-textarea')).toBeFocused()
        await window.keyboard.type(buildEchoSequenceCommand(`OPENCOVE_SCROLLBAR_GUTTER_${nodeId}`, 220))
        await window.keyboard.press('Enter')

        const scrollbar = node.locator('.xterm-scrollable-element .scrollbar.vertical')
        const slider = scrollbar.locator('.slider')
        await expect(slider).toBeVisible({ timeout: 20_000 })

        const viewport = node.locator('.xterm-viewport')
        await expect(viewport).toBeVisible()
        await expect(viewport).toHaveCSS('overflow-y', 'hidden')
        await expect(viewport).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

        const terminalBody = node.locator('.terminal-node__terminal')
        await expect(terminalBody).toBeVisible()
        await expect(terminalBody).not.toHaveCSS('background-color', 'rgb(0, 0, 0)')

        const hitTest = await window.evaluate(id => {
          const api = window.__opencoveTerminalSelectionTestApi
          if (!api) {
            return { ok: false as const, reason: 'missing test api' }
          }

          const size = api.getSize(id)
          if (!size) {
            return { ok: false as const, reason: 'missing terminal size' }
          }

          const center = api.getCellCenter(id, size.cols, size.rows)
          if (!center) {
            return { ok: false as const, reason: 'missing cell center' }
          }

          const hitTarget = document.elementFromPoint(center.x, center.y)
          if (!hitTarget) {
            return { ok: false as const, reason: 'missing hit target' }
          }

          return {
            ok: true as const,
            size,
            point: center,
            tagName: hitTarget.tagName,
            className: hitTarget instanceof HTMLElement ? hitTarget.className : '',
            insideScrollbar: hitTarget.closest('.xterm-scrollable-element .scrollbar.vertical') !== null,
            insideResizer: hitTarget.closest('.terminal-node__resizer') !== null,
            insideScreen: hitTarget.closest('.xterm-screen') !== null,
          }
        }, nodeId)

        expect(hitTest.ok ? hitTest.insideScreen : false, hitTest.ok ? undefined : hitTest.reason).toBe(
          true,
        )
        expect(
          hitTest.ok ? hitTest.insideScrollbar : true,
          hitTest.ok ? undefined : hitTest.reason,
        ).toBe(false)
        expect(
          hitTest.ok ? hitTest.insideResizer : true,
          hitTest.ok ? undefined : hitTest.reason,
        ).toBe(false)
      }

      await assertTerminalSurface('node-a', nodes.nth(0))
      await assertTerminalSurface('node-b', nodes.nth(1))
    } finally {
      await electronApp.close()
    }
  })
})
