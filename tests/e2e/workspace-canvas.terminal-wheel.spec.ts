import { expect, test } from '@playwright/test'
import {
  buildEchoSequenceCommand,
  clearAndSeedWorkspace,
  launchApp,
  testWorkspacePath,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Terminal Wheel', () => {
  test('wheel over terminal does not zoom canvas', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-wheel',
          title: 'terminal-wheel',
          position: { x: 120, y: 120 },
          width: 460,
          height: 300,
        },
      ])

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()
      await expect(terminal.locator('.xterm')).toBeVisible()

      const viewport = window.locator('.react-flow__viewport')
      const beforeTransform = await viewport.getAttribute('style')

      await terminal.hover()
      await window.mouse.wheel(0, -1200)

      const afterTransform = await viewport.getAttribute('style')
      expect(afterTransform).toBe(beforeTransform)
      await expect(terminal.locator('.xterm')).toBeVisible()
    } finally {
      await electronApp.close()
    }
  })

  test('wheel over terminal scrolls terminal viewport', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-scroll',
          title: 'terminal-scroll',
          position: { x: 120, y: 120 },
          width: 460,
          height: 300,
        },
      ])

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()
      const xterm = terminal.locator('.xterm')
      await expect(xterm).toBeVisible()
      await xterm.click()
      const terminalInput = terminal.locator('.xterm-helper-textarea')
      await expect(terminalInput).toBeFocused()
      await window.keyboard.type(buildEchoSequenceCommand('OPENCOVE_SCROLL', 260))
      await window.keyboard.press('Enter')
      await expect(terminal).toContainText('OPENCOVE_SCROLL_260')

      const viewport = terminal.locator('.xterm-viewport')
      await expect(viewport).toBeVisible()
      const beforeViewportY = await window.evaluate(nodeId => {
        return window.__opencoveTerminalSelectionTestApi?.getViewportY(nodeId) ?? null
      }, 'node-scroll')

      await terminal.hover()
      await window.mouse.wheel(0, -1200)
      await window.waitForTimeout(120)

      const afterViewportY = await window.evaluate(nodeId => {
        return window.__opencoveTerminalSelectionTestApi?.getViewportY(nodeId) ?? null
      }, 'node-scroll')
      expect(beforeViewportY).not.toBeNull()
      expect(afterViewportY).not.toBeNull()
      expect(afterViewportY).toBeLessThan(beforeViewportY as number)
    } finally {
      await electronApp.close()
    }
  })

  test('wheel over a hydrated agent node scrolls the viewport instead of the canvas', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-agent-scroll',
          title: 'codex · gpt-5.2-codex',
          position: { x: 120, y: 120 },
          width: 460,
          height: 300,
          kind: 'agent',
          status: 'running',
          startedAt: '2026-02-09T00:00:00.000Z',
          endedAt: null,
          exitCode: null,
          lastError: null,
          agent: {
            provider: 'codex',
            prompt: 'hydrate into fallback shell and keep scroll working',
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
      ])

      const agentNode = window.locator('.terminal-node').first()
      await expect(agentNode).toBeVisible()
      const xterm = agentNode.locator('.xterm')
      await expect(xterm).toBeVisible()
      await xterm.click()
      const terminalInput = agentNode.locator('.xterm-helper-textarea')
      await expect(terminalInput).toBeFocused()
      await window.keyboard.type(buildEchoSequenceCommand('OPENCOVE_AGENT_SCROLL', 260))
      await window.keyboard.press('Enter')
      await expect(agentNode).toContainText('OPENCOVE_AGENT_SCROLL_260')

      const canvasViewport = window.locator('.react-flow__viewport')
      const beforeTransform = await canvasViewport.getAttribute('style')
      const terminalViewport = agentNode.locator('.xterm-viewport')
      await expect(terminalViewport).toBeVisible()
      const beforeViewportY = await window.evaluate(nodeId => {
        return window.__opencoveTerminalSelectionTestApi?.getViewportY(nodeId) ?? null
      }, 'node-agent-scroll')

      await agentNode.hover()
      await window.mouse.wheel(0, -1200)
      await window.waitForTimeout(120)

      const afterViewportY = await window.evaluate(nodeId => {
        return window.__opencoveTerminalSelectionTestApi?.getViewportY(nodeId) ?? null
      }, 'node-agent-scroll')
      const afterTransform = await canvasViewport.getAttribute('style')
      expect(beforeViewportY).not.toBeNull()
      expect(afterViewportY).not.toBeNull()
      expect(afterViewportY).toBeLessThan(beforeViewportY as number)
      expect(afterTransform).toBe(beforeTransform)
    } finally {
      await electronApp.close()
    }
  })
})
