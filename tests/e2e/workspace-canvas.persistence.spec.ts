import { expect, test } from '@playwright/test'
import {
  buildNodeEvalCommand,
  buildPaddedNumberSequenceCommand,
  clearAndSeedWorkspace,
  launchApp,
  seedWorkspaceState,
  storageKey,
  testWorkspacePath,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Persistence', () => {
  test('preserves terminal history after workspace switch', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-a',
        workspaces: [
          {
            id: 'workspace-a',
            name: 'workspace-a',
            path: testWorkspacePath,
            nodes: [
              {
                id: 'node-a',
                title: 'terminal-a',
                position: { x: 120, y: 120 },
                width: 460,
                height: 300,
              },
            ],
          },
          {
            id: 'workspace-b',
            name: 'workspace-b',
            path: testWorkspacePath,
            nodes: [
              {
                id: 'node-b',
                title: 'terminal-b',
                position: { x: 160, y: 160 },
                width: 460,
                height: 300,
              },
            ],
          },
        ],
      })

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()
      await expect(terminal.locator('.xterm')).toBeVisible()

      const token = `OPENCOVE_PERSIST_${Date.now()}`
      await terminal.locator('.xterm').click()
      await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()
      await window.keyboard.type(`echo ${token}`)
      await window.keyboard.press('Enter')
      await expect(terminal).toContainText(token)

      await window.locator('.workspace-item').nth(1).click()
      await expect(window.locator('.workspace-item').nth(1)).toHaveClass(/workspace-item--active/)
      await expect(window.locator('.terminal-node')).toHaveCount(1)

      await window.locator('.workspace-item').nth(0).click()
      await expect(window.locator('.workspace-item').nth(0)).toHaveClass(/workspace-item--active/)
      await expect(window.locator('.terminal-node')).toHaveCount(1)
      await expect(window.locator('.terminal-node').first()).toContainText(token)
    } finally {
      await electronApp.close()
    }
  })

  test('preserves large terminal history after workspace switch', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-a',
        workspaces: [
          {
            id: 'workspace-a',
            name: 'workspace-a',
            path: testWorkspacePath,
            nodes: [
              {
                id: 'node-a',
                title: 'terminal-a',
                position: { x: 120, y: 120 },
                width: 460,
                height: 300,
              },
            ],
          },
          {
            id: 'workspace-b',
            name: 'workspace-b',
            path: testWorkspacePath,
            nodes: [
              {
                id: 'node-b',
                title: 'terminal-b',
                position: { x: 160, y: 160 },
                width: 460,
                height: 300,
              },
            ],
          },
        ],
      })

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()
      await expect(terminal.locator('.xterm')).toBeVisible()

      const headToken = `OPENCOVE_SCROLLBACK_HEAD_${Date.now()}`
      const tailToken = `OPENCOVE_SCROLLBACK_TAIL_${Date.now()}`

      await terminal.locator('.xterm').click()
      await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()

      await window.keyboard.type(
        [`echo ${headToken}`, buildPaddedNumberSequenceCommand(4500, 45), `echo ${tailToken}`].join(
          '; ',
        ),
      )
      await window.keyboard.press('Enter')
      await expect(terminal).toContainText(tailToken, { timeout: 20_000 })

      await window.waitForTimeout(200)
      const scrollbar = terminal.locator('.xterm-scrollable-element .scrollbar.vertical')
      const slider = scrollbar.locator('.slider')
      await expect(slider).toBeVisible()

      const scrollbarBox = await scrollbar.boundingBox()
      const sliderBox = await slider.boundingBox()
      if (scrollbarBox && sliderBox) {
        await window.mouse.move(
          sliderBox.x + sliderBox.width / 2,
          sliderBox.y + sliderBox.height / 2,
        )
        await window.mouse.down()
        await window.mouse.move(scrollbarBox.x + scrollbarBox.width / 2, scrollbarBox.y + 1)
        await window.mouse.up()
      }
      await expect(terminal).toContainText(headToken, { timeout: 20_000 })

      await window.locator('.workspace-item').nth(1).click()
      await expect(window.locator('.workspace-item').nth(1)).toHaveClass(/workspace-item--active/)
      await expect(window.locator('.terminal-node')).toHaveCount(1)

      await window.locator('.workspace-item').nth(0).click()
      await expect(window.locator('.workspace-item').nth(0)).toHaveClass(/workspace-item--active/)
      await expect(window.locator('.terminal-node')).toHaveCount(1)

      const restoredTerminal = window.locator('.terminal-node').first()
      await expect(restoredTerminal).toContainText(tailToken, { timeout: 20_000 })

      const restoredScrollbar = restoredTerminal.locator(
        '.xterm-scrollable-element .scrollbar.vertical',
      )
      const restoredSlider = restoredScrollbar.locator('.slider')
      await expect(restoredSlider).toBeVisible()

      const restoredScrollbarBox = await restoredScrollbar.boundingBox()
      const restoredSliderBox = await restoredSlider.boundingBox()
      if (restoredScrollbarBox && restoredSliderBox) {
        await window.mouse.move(
          restoredSliderBox.x + restoredSliderBox.width / 2,
          restoredSliderBox.y + restoredSliderBox.height / 2,
        )
        await window.mouse.down()
        await window.mouse.move(
          restoredScrollbarBox.x + restoredScrollbarBox.width / 2,
          restoredScrollbarBox.y + 1,
        )
        await window.mouse.up()
      }
      await expect(restoredTerminal).toContainText(headToken, { timeout: 20_000 })
    } finally {
      await electronApp.close()
    }
  })

  test('preserves terminal history if command exits while workspace inactive', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-a',
        workspaces: [
          {
            id: 'workspace-a',
            name: 'workspace-a',
            path: testWorkspacePath,
            nodes: [
              {
                id: 'node-a',
                title: 'terminal-a',
                position: { x: 120, y: 120 },
                width: 460,
                height: 300,
              },
            ],
          },
          {
            id: 'workspace-b',
            name: 'workspace-b',
            path: testWorkspacePath,
            nodes: [
              {
                id: 'node-b',
                title: 'terminal-b',
                position: { x: 160, y: 160 },
                width: 460,
                height: 300,
              },
            ],
          },
        ],
      })

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()
      await expect(terminal.locator('.xterm')).toBeVisible()

      await window.evaluate(() => {
        ;(window as unknown as { __opencoveTestExitCode?: number | null }).__opencoveTestExitCode =
          null

        const unsubscribe = window.opencoveApi.pty.onExit(event => {
          ;(
            window as unknown as { __opencoveTestExitCode?: number | null }
          ).__opencoveTestExitCode = event.exitCode
          unsubscribe()
        })
      })

      const token = `OPENCOVE_INACTIVE_EXIT_${Date.now()}`
      await terminal.locator('.xterm').click()
      await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()
      await window.keyboard.type(`sleep 1; echo ${token}; exit`)
      await window.keyboard.press('Enter')

      await window.locator('.workspace-item').nth(1).click()
      await expect(window.locator('.workspace-item').nth(1)).toHaveClass(/workspace-item--active/)
      await expect(window.locator('.terminal-node')).toHaveCount(1)

      await expect
        .poll(
          async () => {
            return await window.evaluate(
              () =>
                (window as unknown as { __opencoveTestExitCode?: number | null })
                  .__opencoveTestExitCode,
            )
          },
          { timeout: 10_000 },
        )
        .toBe(0)

      await window.locator('.workspace-item').nth(0).click()
      await expect(window.locator('.workspace-item').nth(0)).toHaveClass(/workspace-item--active/)
      await expect(window.locator('.terminal-node')).toHaveCount(1)
      await expect(window.locator('.terminal-node').first()).toContainText(token)
    } finally {
      await electronApp.close()
    }
  })

  test('keeps arrow-key history recall working after restoring a terminal that exited raw mode while inactive', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-a',
        workspaces: [
          {
            id: 'workspace-a',
            name: 'workspace-a',
            path: testWorkspacePath,
            nodes: [
              {
                id: 'node-a',
                title: 'terminal-a',
                position: { x: 120, y: 120 },
                width: 460,
                height: 300,
              },
            ],
          },
          {
            id: 'workspace-b',
            name: 'workspace-b',
            path: testWorkspacePath,
            nodes: [
              {
                id: 'node-b',
                title: 'terminal-b',
                position: { x: 160, y: 160 },
                width: 460,
                height: 300,
              },
            ],
          },
        ],
      })

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()
      await expect(terminal.locator('.xterm')).toBeVisible()

      const rawModeDoneToken = `OPENCOVE_ARROW_HISTORY_DONE_${Date.now()}`
      const rawModeCommand = buildNodeEvalCommand(
        [
          'process.stdout.write("\\x1b[?1049h\\x1b[?1hOPENCOVE_ARROW_HISTORY_START\\n");',
          'if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {',
          '  process.stdin.setRawMode(true);',
          '}',
          'setTimeout(() => {',
          '  if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {',
          '    process.stdin.setRawMode(false);',
          '  }',
          `  process.stdout.write("\\x1b[?1l\\x1b[?1049l${rawModeDoneToken}\\n");`,
          '  process.exit(0);',
          '}, 600);',
        ].join(''),
      )

      await terminal.locator('.xterm').click()
      await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()
      await window.keyboard.type(rawModeCommand)
      await window.keyboard.press('Enter')

      await expect(terminal).toContainText('OPENCOVE_ARROW_HISTORY_START', { timeout: 20_000 })

      await window.locator('.workspace-item').nth(1).click()
      await expect(window.locator('.workspace-item').nth(1)).toHaveClass(/workspace-item--active/)

      await expect
        .poll(
          async () => {
            return await window.evaluate(
              async ({ key, nodeId, expected }) => {
                void key

                const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
                if (!raw) {
                  return false
                }

                const parsed = JSON.parse(raw) as {
                  workspaces?: Array<{
                    id?: string
                    nodes?: Array<{
                      id?: string
                      scrollback?: string | null
                    }>
                  }>
                }

                const workspace = parsed.workspaces?.find(item => item.id === 'workspace-a')
                const node = workspace?.nodes?.find(item => item.id === nodeId)
                return typeof node?.scrollback === 'string' && node.scrollback.includes(expected)
              },
              {
                key: storageKey,
                nodeId: 'node-a',
                expected: rawModeDoneToken,
              },
            )
          },
          { timeout: 10_000 },
        )
        .toBe(true)

      await window.locator('.workspace-item').nth(0).click()
      await expect(window.locator('.workspace-item').nth(0)).toHaveClass(/workspace-item--active/)

      const restoredTerminal = window.locator('.terminal-node').first()
      await expect(restoredTerminal).toContainText(rawModeDoneToken, { timeout: 20_000 })

      await restoredTerminal.locator('.xterm').click()
      await expect(restoredTerminal.locator('.xterm-helper-textarea')).toBeFocused()
      await window.keyboard.press('ArrowUp')
      await window.keyboard.press('Enter')

      await expect
        .poll(async () => {
          const text = (await restoredTerminal.textContent()) ?? ''
          return (text.match(new RegExp(rawModeDoneToken, 'g')) ?? []).length >= 2
        })
        .toBe(true)
      await expect(restoredTerminal).not.toContainText('^[[A')
    } finally {
      await electronApp.close()
    }
  })

  test('preserves terminal history after app reload', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-reload',
          title: 'terminal-reload',
          position: { x: 120, y: 120 },
          width: 460,
          height: 300,
        },
      ])

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()
      await expect(terminal.locator('.xterm')).toBeVisible()

      const token = `OPENCOVE_RELOAD_${Date.now()}`
      await terminal.locator('.xterm').click()
      await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()
      await window.keyboard.type(`echo ${token}`)
      await window.keyboard.press('Enter')
      await expect(terminal).toContainText(token)

      await expect
        .poll(
          async () => {
            return await window.evaluate(
              async ({ key, nodeId, expected }) => {
                void key

                const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
                if (!raw) {
                  return false
                }

                const parsed = JSON.parse(raw) as {
                  workspaces?: Array<{
                    id?: string
                    nodes?: Array<{
                      id?: string
                      scrollback?: string | null
                    }>
                  }>
                }

                const workspace = parsed.workspaces?.find(item => item.id === 'workspace-seeded')
                const node = workspace?.nodes?.find(item => item.id === nodeId)
                return typeof node?.scrollback === 'string' && node.scrollback.includes(expected)
              },
              {
                key: storageKey,
                nodeId: 'node-reload',
                expected: token,
              },
            )
          },
          { timeout: 10_000 },
        )
        .toBe(true)

      await window.reload({ waitUntil: 'domcontentloaded' })

      const reloadedTerminal = window.locator('.terminal-node').first()
      await expect(reloadedTerminal).toBeVisible()
      await expect(reloadedTerminal.locator('.xterm')).toBeVisible()
      await expect(reloadedTerminal).toContainText(token)
      await expect(reloadedTerminal).not.toContainText('^[')
    } finally {
      await electronApp.close()
    }
  })
})
