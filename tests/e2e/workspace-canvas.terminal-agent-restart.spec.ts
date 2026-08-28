import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import {
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  seedWorkspaceState,
  testWorkspacePath,
} from './workspace-canvas.helpers'
import {
  createAgentCommandPath,
  expectOverlayStubReady,
  readPersistedTerminalAgentNode,
  readRuntimeSessionId,
} from './workspace-canvas.terminal-agent-overlay.helpers'

type MetadataWindow = typeof window & { __terminalAgentRestartMetadata?: unknown[] }

test.describe('Workspace Canvas - terminal Agent full restart', () => {
  test.skip(process.platform === 'win32', 'POSIX command shim coverage')

  for (const provider of ['claude-code', 'codex'] as const) {
    test(`resumes the exact verified ${provider} binding once and restores the terminal surface`, async () => {
      const command = provider === 'claude-code' ? 'claude' : 'codex'
      const userDataDir = await createTestUserDataDir()
      const invocationLogPath = path.join(userDataDir, `${command}-invocations.log`)
      const commandDirectory = await createAgentCommandPath({ invocationLogPath })
      await mkdir(testWorkspacePath, { recursive: true })
      const executionDirectory = await mkdtemp(path.join(testWorkspacePath, `${command}-restart-`))
      const workspaceId = `workspace-restart-${command}`
      const nodeId = `terminal-restart-${command}`
      const continuitySentinel = `PRE_RESTART_OUTPUT_${command.toUpperCase()}`
      const env = {
        PATH: `${commandDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
        OPENCOVE_TEST_CLAUDE_HOOK_INSTALL_FAILURE: '0',
        OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
      }
      let initialRuntimeSessionId: string | null = null
      let durableResumeSessionId: string | null = null

      try {
        const { electronApp, window } = await launchApp({
          windowMode: 'offscreen',
          userDataDir,
          cleanupUserDataDir: false,
          env,
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
                    title: `${provider} restart terminal`,
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

          const terminal = window.locator(`[data-id="${nodeId}"] .terminal-node`)
          await expect(terminal).toBeVisible()
          await expect.poll(() => readRuntimeSessionId(window, nodeId)).toBeTruthy()
          initialRuntimeSessionId = await readRuntimeSessionId(window, nodeId)
          await window.evaluate(() => {
            const testWindow = window as MetadataWindow
            testWindow.__terminalAgentRestartMetadata = []
            window.opencoveApi.pty.onMetadata(event => {
              testWindow.__terminalAgentRestartMetadata?.push(event)
            })
          })
          await terminal.locator('.xterm-helper-textarea').click()
          await window.keyboard.type(`printf '${continuitySentinel}\\n'`)
          await window.keyboard.press('Enter')
          await expect
            .poll(
              async () =>
                (await terminal.locator('.terminal-node__transcript').textContent()) ?? '',
            )
            .toContain(continuitySentinel)

          await window.keyboard.type(command)
          await window.keyboard.press('Enter')
          await expectOverlayStubReady(terminal, provider)
          await expect
            .poll(async () => (await readFile(invocationLogPath, 'utf8')).split(/\r?\n/u))
            .toContainEqual(
              expect.stringContaining(provider === 'claude-code' ? '--settings ' : 'notify='),
            )
          await expect
            .poll(
              async () =>
                await window.evaluate(
                  () => (window as MetadataWindow).__terminalAgentRestartMetadata ?? [],
                ),
            )
            .toContainEqual(
              expect.objectContaining({
                terminalAgentActivity: expect.objectContaining({
                  provider,
                  identityAuthority: 'provider_session_start',
                }),
              }),
            )
          await expect
            .poll(async () => {
              const binding = (await readPersistedTerminalAgentNode(window, nodeId))?.agent
              return binding?.resumeSessionIdVerified === true ? binding.resumeSessionId : null
            })
            .toBeTruthy()
          durableResumeSessionId =
            (await readPersistedTerminalAgentNode(window, nodeId))?.agent?.resumeSessionId ?? null
        } finally {
          await electronApp.close()
        }

        const { electronApp: restartedApp, window: restartedWindow } = await launchApp({
          windowMode: 'offscreen',
          userDataDir,
          cleanupUserDataDir: true,
          env,
        })

        try {
          const resumeSuffix =
            provider === 'claude-code'
              ? ` --resume ${durableResumeSessionId}`
              : ` resume ${durableResumeSessionId}`
          await expect
            .poll(async () => (await readFile(invocationLogPath, 'utf8')).split(/\r?\n/u))
            .toContainEqual(expect.stringMatching(new RegExp(`${resumeSuffix}$`, 'u')))
          const invocations = (await readFile(invocationLogPath, 'utf8')).split(/\r?\n/u)
          expect(invocations.filter(invocation => invocation.endsWith(resumeSuffix))).toHaveLength(
            1,
          )

          const terminal = restartedWindow.locator(`[data-id="${nodeId}"] .terminal-node`)
          const sidebarItem = restartedWindow.locator(
            `[data-testid="workspace-agent-item-${workspaceId}-${nodeId}"]`,
          )
          await expect(terminal).toBeVisible()
          await expect(sidebarItem).toBeVisible()
          await expect(terminal.getByTestId('terminal-node-copy-last-message')).toBeVisible()
          await expect(terminal.getByTestId('terminal-node-reload-session')).toBeVisible()
          await expect(terminal.getByTestId('terminal-node-session-list')).toBeVisible()
          await expectOverlayStubReady(terminal, provider)
          await terminal.locator('.xterm-helper-textarea').click()
          await restartedWindow.keyboard.press('Control+C')
          await expect
            .poll(
              async () =>
                (await terminal.locator('.terminal-node__transcript').textContent()) ?? '',
            )
            .toContain(continuitySentinel)
          await expect
            .poll(() => readRuntimeSessionId(restartedWindow, nodeId))
            .not.toBe(initialRuntimeSessionId)
          await expect
            .poll(() => readPersistedTerminalAgentNode(restartedWindow, nodeId))
            .toMatchObject({
              agent: {
                provider,
                resumeSessionId: durableResumeSessionId,
                resumeSessionIdVerified: true,
              },
            })
        } finally {
          await restartedApp.close()
        }
      } finally {
        await rm(commandDirectory, { recursive: true, force: true })
        await rm(executionDirectory, { recursive: true, force: true })
        await removePathWithRetry(userDataDir)
      }
    })
  }
})
