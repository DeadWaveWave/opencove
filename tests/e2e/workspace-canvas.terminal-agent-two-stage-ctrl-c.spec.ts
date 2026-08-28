import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'
import {
  createAgentCommandPath,
  readPersistedTerminalAgentNode,
  readRuntimeSessionId,
} from './workspace-canvas.terminal-agent-overlay.helpers'

function outputLines(output: string): string[] {
  return output.split(/\r?\n/u).map(line => line.trim())
}

async function expectAgentSurface(options: {
  sidebarItem: Locator
  terminal: Locator
}): Promise<void> {
  const { sidebarItem, terminal } = options
  await expect(sidebarItem).toBeVisible()
  await expect(terminal.locator('.terminal-node__status')).toBeVisible()
  await expect(terminal.getByTestId('terminal-node-copy-last-message')).toBeVisible()
  await expect(terminal.getByTestId('terminal-node-reload-session')).toBeVisible()
  await expect(terminal.getByTestId('terminal-node-session-list')).toBeVisible()
}

async function readTranscript(terminal: Locator): Promise<string> {
  return (await terminal.locator('.terminal-node__transcript').textContent()) ?? ''
}

async function expectShellReadyAfterMarker(terminal: Locator, marker: string): Promise<void> {
  await expect
    .poll(async () => {
      const transcript = await readTranscript(terminal)
      const markerIndex = transcript.lastIndexOf(marker)
      return markerIndex >= 0 && /[%$#]/u.test(transcript.slice(markerIndex + marker.length))
    })
    .toBe(true)
}

async function expectExactBinding(options: {
  nodeId: string
  provider: 'claude-code' | 'codex'
  resumeSessionId: string
  runtimeSessionId: string
  window: Page
}): Promise<void> {
  const persisted = await readPersistedTerminalAgentNode(options.window, options.nodeId)
  expect(persisted).toMatchObject({
    id: options.nodeId,
    kind: 'terminal',
    sessionId: options.runtimeSessionId,
  })
  expect(persisted?.agent).toEqual({
    provider: options.provider,
    resumeSessionId: options.resumeSessionId,
    resumeSessionIdVerified: true,
  })
  expect(await readRuntimeSessionId(options.window, options.nodeId)).toBe(options.runtimeSessionId)
}

test.describe('Workspace Canvas - verified terminal Agent two-stage Ctrl+C', () => {
  test.skip(process.platform === 'win32', 'POSIX command shim coverage')

  for (const provider of ['claude-code', 'codex'] as const) {
    test(`${provider} keeps its verified Agent surface after cancellation and provider exit`, async () => {
      const command = provider === 'claude-code' ? 'claude' : 'codex'
      const commandDirectory = await createAgentCommandPath({
        scenario: 'jsonl-two-stage-ctrl-c',
      })
      await mkdir(testWorkspacePath, { recursive: true })
      const executionDirectory = await mkdtemp(
        path.join(testWorkspacePath, `${command}-two-stage-ctrl-c-`),
      )
      const providerPidPath = path.join(executionDirectory, `${command}-provider.pid`)
      const workspaceId = `workspace-two-stage-ctrl-c-${command}`
      const nodeId = `terminal-two-stage-ctrl-c-${command}`
      const readyMarker = `[opencove-test-2c] ${provider} ready`
      const cancellationMarker = `[opencove-test-2c] ${provider} cancel-alt-exit`
      const exitMarker = `[opencove-test-2c] ${provider} provider-exit`
      const { electronApp, window } = await launchApp({
        windowMode: 'offscreen',
        env: {
          PATH: `${commandDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
          OPENCOVE_TEST_CLAUDE_HOOK_INSTALL_FAILURE: '0',
          OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
          OPENCOVE_TEST_TWO_STAGE_PROVIDER_PID_PATH: providerPidPath,
        },
      })

      try {
        await seedWorkspaceState(window, {
          activeWorkspaceId: workspaceId,
          workspaces: [
            {
              id: workspaceId,
              name: workspaceId,
              path: testWorkspacePath,
              activeSpaceId: null,
              nodes: [
                {
                  id: nodeId,
                  title: `${provider} two-stage Ctrl+C terminal`,
                  position: { x: 180, y: 160 },
                  width: 520,
                  height: 400,
                  kind: 'terminal',
                  executionDirectory,
                },
              ],
              spaces: [],
            },
          ],
        })

        let terminal = window.locator(`[data-id="${nodeId}"] .terminal-node`)
        let sidebarItem = window.locator(
          `[data-testid="workspace-agent-item-${workspaceId}-${nodeId}"]`,
        )
        await expect(terminal).toBeVisible()
        await expect.poll(() => readRuntimeSessionId(window, nodeId)).not.toBeNull()
        const runtimeSessionId = await readRuntimeSessionId(window, nodeId)
        expect(runtimeSessionId).not.toBeNull()
        if (runtimeSessionId === null) {
          throw new Error(`Expected a runtime session for ${provider}`)
        }

        await terminal.locator('.xterm-helper-textarea').click()
        await window.keyboard.type(command)
        await window.keyboard.press('Enter')
        await expect
          .poll(async () => outputLines(await readTranscript(terminal)))
          .toContain(readyMarker)
        await expect
          .poll(async () => {
            const binding = (await readPersistedTerminalAgentNode(window, nodeId))?.agent
            return binding?.resumeSessionIdVerified === true && binding.provider === provider
          })
          .toBe(true)

        const readyBinding = (await readPersistedTerminalAgentNode(window, nodeId))?.agent
        expect(readyBinding).toMatchObject({ provider, resumeSessionIdVerified: true })
        const resumeSessionId = readyBinding?.resumeSessionId
        expect(resumeSessionId).not.toBeNull()
        expect(resumeSessionId).toBeDefined()
        if (!resumeSessionId) {
          throw new Error(`Expected a verified ${provider} resume session ID`)
        }
        const providerPid = Number(await readFile(providerPidPath, 'utf8'))
        expect(Number.isSafeInteger(providerPid)).toBe(true)
        expect(() => process.kill(providerPid, 0)).not.toThrow()
        await expectExactBinding({
          window,
          nodeId,
          provider,
          resumeSessionId,
          runtimeSessionId,
        })
        await expectAgentSurface({ terminal, sidebarItem })

        // Rehydrate from the authenticated durable binding after the provider hook metadata has
        // replaced the runtime-only activity snapshot. This deterministically exercises the gap
        // where presentation evidence must not become authority over the verified binding.
        await window.reload({ waitUntil: 'domcontentloaded' })
        terminal = window.locator(`[data-id="${nodeId}"] .terminal-node`)
        sidebarItem = window.locator(
          `[data-testid="workspace-agent-item-${workspaceId}-${nodeId}"]`,
        )
        await expect(terminal).toBeVisible()
        await expect.poll(() => readRuntimeSessionId(window, nodeId)).toBe(runtimeSessionId)
        await expectAgentSurface({ terminal, sidebarItem })
        await expectExactBinding({
          window,
          nodeId,
          provider,
          resumeSessionId,
          runtimeSessionId,
        })
        const statusBeforeCancellation =
          (await terminal.locator('.terminal-node__status').textContent())?.trim() ?? ''
        expect(statusBeforeCancellation.length).toBeGreaterThan(0)

        await terminal.locator('.xterm-helper-textarea').click()
        await window.keyboard.press('Control+C')
        await expect
          .poll(async () => outputLines(await readTranscript(terminal)))
          .toContain(cancellationMarker)

        const afterCancellationLines = outputLines(await readTranscript(terminal))
        expect(afterCancellationLines).toContain(cancellationMarker)
        expect(afterCancellationLines).not.toContain(exitMarker)
        expect(() => process.kill(providerPid, 0)).not.toThrow()
        await expectAgentSurface({ terminal, sidebarItem })
        await expect(sidebarItem).toContainText(statusBeforeCancellation)
        await expect(terminal.locator('.terminal-node__status')).toHaveText(
          statusBeforeCancellation,
        )
        await expectExactBinding({
          window,
          nodeId,
          provider,
          resumeSessionId,
          runtimeSessionId,
        })

        await window.keyboard.press('Control+C')
        await expectShellReadyAfterMarker(terminal, exitMarker)

        expect(outputLines(await readTranscript(terminal))).toContain(exitMarker)
        expect(() => process.kill(providerPid, 0)).toThrow()
        await expectAgentSurface({ terminal, sidebarItem })
        await expectExactBinding({
          window,
          nodeId,
          provider,
          resumeSessionId,
          runtimeSessionId,
        })
      } finally {
        await electronApp.close()
        await rm(commandDirectory, { recursive: true, force: true })
        await rm(executionDirectory, { recursive: true, force: true })
      }
    })
  }
})
