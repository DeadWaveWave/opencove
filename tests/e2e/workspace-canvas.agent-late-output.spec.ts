import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

test('reveals a new Claude Code Agent when its first output arrives late', async ({
  browserName: _browserName,
}, testInfo) => {
  const { electronApp, window } = await launchApp({
    env: {
      OPENCOVE_TEST_USE_REAL_AGENTS: '0',
      OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'raw-late-first-output',
      OPENCOVE_TERMINAL_DIAGNOSTICS: '1',
    },
  })
  try {
    const cdp = await window.context().newCDPSession(window)
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'prefers-reduced-motion', value: 'reduce' },
        { name: 'prefers-reduced-transparency', value: 'reduce' },
      ],
    })
    await clearAndSeedWorkspace(window, [], { settings: { defaultProvider: 'claude-code' } })
    const pane = window.locator('.workspace-canvas .react-flow__pane')
    await pane.click({ button: 'right' })
    await window.getByTestId('workspace-context-run-default-agent').click()

    const agent = window
      .locator('.react-flow__node')
      .filter({ has: window.locator('.terminal-node') })
    await expect(agent).toHaveCount(1)
    const nodeId = await agent.getAttribute('data-id')
    expect(nodeId).toBeTruthy()

    await expect
      .poll(
        () =>
          window.evaluate(id => {
            const buffer = window.__opencoveTerminalSelectionTestApi?.getBufferText(
              id,
              'late plain',
            )
            return {
              recovering: document.querySelector('.terminal-node__recovering') !== null,
              lines: buffer?.viewportLines.filter(line => line.trim().length > 0) ?? [],
            }
          }, nodeId!),
        { timeout: 5_000 },
      )
      .toEqual({ recovering: false, lines: ['late plain'] })

    await testInfo.attach('late-output-revealed', {
      body: await window.screenshot({ path: testInfo.outputPath('late-output-revealed.png') }),
      contentType: 'image/png',
    })
  } catch (error) {
    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    await testInfo.attach('terminal-diagnostics', {
      body: await readFile(path.join(userDataDir, 'logs', 'terminal-diagnostics.log')),
      contentType: 'text/plain',
    })
    await testInfo.attach('late-output-state', {
      body: JSON.stringify(
        await window.evaluate(async () => {
          const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
          const state = JSON.parse(raw ?? '{}') as {
            workspaces?: Array<{ nodes?: Array<{ sessionId?: string }> }>
          }
          const node = state.workspaces?.[0]?.nodes?.[0]
          return {
            node,
            snapshot: node?.sessionId
              ? await window.opencoveApi.pty.presentationSnapshot({ sessionId: node.sessionId })
              : null,
            recovering: document.querySelector('.terminal-node__recovering')?.textContent,
          }
        }),
        null,
        2,
      ),
      contentType: 'application/json',
    })
    await testInfo.attach('late-output-stuck', {
      body: await window.screenshot(),
      contentType: 'image/png',
    })
    throw error
  } finally {
    await electronApp.close()
  }
})
