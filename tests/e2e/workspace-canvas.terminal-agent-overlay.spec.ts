import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import type { TerminalSessionMetadataEvent } from '../../src/shared/contracts/dto'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'
import {
  createAgentCommandPath,
  createFailedCodexCommandPath,
  expectOverlayStubReady,
  readPersistedTerminalAgentNode as readPersistedNode,
  readRuntimeSessionId,
} from './workspace-canvas.terminal-agent-overlay.helpers'

const overlayAdvanceSentinel = '<test-overlay-advance>'
type MetadataTestWindow = typeof window & {
  __opencoveTerminalAgentMetadata?: TerminalSessionMetadataEvent[]
}

function hasVerifiedTerminalAgentMetadata(event: TerminalSessionMetadataEvent): boolean {
  return (
    typeof event.sessionId === 'string' &&
    typeof event.resumeSessionId === 'string' &&
    event.terminalAgentActivity?.identityAuthority === 'provider_session_start'
  )
}

async function runOverlayLifecycle(options: {
  window: Page
  nodeId: string
  terminal: Locator
}): Promise<void> {
  const { window, nodeId, terminal } = options
  await expect.poll(() => readRuntimeSessionId(window, nodeId), { timeout: 15_000 }).toBeTruthy()
  const initialSessionId = await readRuntimeSessionId(window, nodeId)
  expect(initialSessionId).not.toBeNull()

  await terminal.locator('.xterm-helper-textarea').click()
  await window.keyboard.type('claude')
  await window.keyboard.press('Enter')
  await expectOverlayStubReady(terminal, 'claude-code')

  const sidebarItem = window.locator(
    `[data-testid="workspace-agent-item-workspace-overlay-${nodeId}"]`,
  )
  await expect(sidebarItem).toBeVisible({ timeout: 15_000 })
  await expect(sidebarItem).toContainText('Working')
  await expect(terminal.locator('.terminal-node__status')).toHaveText('Working')
  await expect(terminal.getByTestId('terminal-node-copy-last-message')).toBeVisible()
  await expect(terminal.getByTestId('terminal-node-reload-session')).toBeVisible()
  await expect(terminal.getByTestId('terminal-node-session-list')).toBeVisible()
  await window.keyboard.type(overlayAdvanceSentinel)
  await expect(sidebarItem).toContainText('Standby', { timeout: 15_000 })
  await expect(terminal.locator('.terminal-node__status')).toHaveText('Standby')

  await expect
    .poll(() => readPersistedNode(window, nodeId))
    .toMatchObject({
      id: nodeId,
      kind: 'terminal',
      sessionId: initialSessionId,
      agent: { provider: 'claude-code', resumeSessionIdVerified: true },
    })
  const persistedDuringOverlay = await readPersistedNode(window, nodeId)
  expect(persistedDuringOverlay?.agentOverlay).toBeUndefined()
  expect(await readRuntimeSessionId(window, nodeId)).toBe(initialSessionId)

  await window.keyboard.type('codex')
  await window.keyboard.press('Enter')
  await expect(sidebarItem).toBeVisible()
  expect((await readPersistedNode(window, nodeId))?.agent?.provider).toBe('claude-code')

  await window.keyboard.press('Control+C')
  await expect(sidebarItem).toBeVisible()
  await expect(terminal.getByTestId('terminal-node-copy-last-message')).toBeVisible()
  await expect(terminal.getByTestId('terminal-node-reload-session')).toBeVisible()
  await expect(terminal.getByTestId('terminal-node-session-list')).toBeVisible()
  await expect
    .poll(() => readPersistedNode(window, nodeId))
    .toMatchObject({
      id: nodeId,
      kind: 'terminal',
      sessionId: initialSessionId,
      agent: { provider: 'claude-code', resumeSessionIdVerified: true },
    })
  expect(await readRuntimeSessionId(window, nodeId)).toBe(initialSessionId)

  await expect
    .poll(async () => {
      const transcript = (await terminal.locator('.terminal-node__transcript').textContent()) ?? ''
      const exitIndex = transcript.lastIndexOf('claude-code exited')
      // The shell prompt glyph is shell/OS-specific (zsh '%', bash/sh '$', root '#');
      // matching any of them keeps the drop-back-to-live-shell check cross-platform.
      return exitIndex >= 0 && /[%$#]/.test(transcript.slice(exitIndex))
    })
    .toBe(true)
  await expect
    .poll(async () => (await readPersistedNode(window, nodeId))?.scrollback ?? '')
    .toContain('claude-code exited')

  await terminal.locator('.xterm-helper-textarea').click()
  await window.keyboard.type('codex')
  expect((await readPersistedNode(window, nodeId))?.agent?.provider).toBe('claude-code')
  await window.keyboard.press('Enter')
  await expectOverlayStubReady(terminal, 'codex')
  await expect(sidebarItem).toContainText('Working')
  await window.keyboard.type(overlayAdvanceSentinel)
  await expect(sidebarItem).toContainText('Standby', { timeout: 15_000 })
  await expect
    .poll(async () => (await readPersistedNode(window, nodeId))?.agent?.provider)
    .toBe('codex')
  expect(await readRuntimeSessionId(window, nodeId)).toBe(initialSessionId)
  expect((await readPersistedNode(window, nodeId))?.scrollback).toContain('claude-code exited')

  await window.keyboard.press('Control+C')
  await expect(sidebarItem).toBeVisible()
}

test.describe('Workspace Canvas - Terminal agent overlay', () => {
  test.skip(process.platform === 'win32', 'POSIX command shim coverage')

  test('drops back to a normal terminal when codex exits before it starts', async () => {
    const commandDirectory = await createFailedCodexCommandPath()
    await mkdir(testWorkspacePath, { recursive: true })
    const executionDirectory = await mkdtemp(path.join(testWorkspacePath, 'agent-launch-failure-'))
    const { electronApp, window } = await launchApp({
      windowMode: 'offscreen',
      env: {
        PATH: `${commandDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
      },
    })

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-agent-launch-failure',
        workspaces: [
          {
            id: 'workspace-agent-launch-failure',
            name: 'workspace-agent-launch-failure',
            path: testWorkspacePath,
            activeSpaceId: null,
            nodes: [
              {
                id: 'terminal-agent-launch-failure',
                title: 'Terminal',
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

      const nodeId = 'terminal-agent-launch-failure'
      const terminal = window.locator(`[data-id="${nodeId}"] .terminal-node`)
      const sidebarItem = window.locator(
        `[data-testid="workspace-agent-item-workspace-agent-launch-failure-${nodeId}"]`,
      )
      await expect(terminal).toBeVisible()
      await expect
        .poll(() => readRuntimeSessionId(window, nodeId), { timeout: 15_000 })
        .toBeTruthy()
      await window.evaluate(() => {
        const testWindow = window as typeof window & {
          __opencoveForegroundEvents?: Array<{ sessionId: string; shellOnly: boolean }>
        }
        testWindow.__opencoveForegroundEvents = []
        window.opencoveApi.pty.onForeground(event => {
          testWindow.__opencoveForegroundEvents?.push(event)
        })
      })

      await terminal.locator('.xterm-helper-textarea').click()
      await window.keyboard.type('codex')
      await window.keyboard.press('Enter')

      await expect
        .poll(() =>
          window.evaluate(() => {
            const testWindow = window as typeof window & {
              __opencoveForegroundEvents?: Array<{ sessionId: string; shellOnly: boolean }>
            }
            return testWindow.__opencoveForegroundEvents ?? []
          }),
        )
        .toContainEqual(expect.objectContaining({ shellOnly: true }))
      await expect(sidebarItem).toHaveCount(0, { timeout: 15_000 })
      await expect(terminal.getByTestId('terminal-node-copy-last-message')).toHaveCount(0)
      await expect(terminal.getByTestId('terminal-node-reload-session')).toHaveCount(0)
      await expect(terminal.getByTestId('terminal-node-session-list')).toHaveCount(0)
      await expect
        .poll(() => readPersistedNode(window, nodeId))
        .toMatchObject({
          id: nodeId,
          kind: 'terminal',
          agent: null,
        })
    } finally {
      await electronApp.close()
      await rm(commandDirectory, { recursive: true, force: true })
      await rm(executionDirectory, { recursive: true, force: true })
    }
  })

  test('re-projects a restored binding and re-derives state without replacing the PTY', async () => {
    const commandDirectory = await createAgentCommandPath()
    await mkdir(testWorkspacePath, { recursive: true })
    const executionDirectory = await mkdtemp(path.join(testWorkspacePath, 'agent-overlay-reload-'))
    const { electronApp, window } = await launchApp({
      windowMode: 'inactive',
      env: {
        PATH: `${commandDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
        OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
      },
    })

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-overlay-reload',
        workspaces: [
          {
            id: 'workspace-overlay-reload',
            name: 'workspace-overlay-reload',
            path: testWorkspacePath,
            activeSpaceId: null,
            nodes: [
              {
                id: 'terminal-reload',
                title: 'Reload agent terminal',
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

      const terminal = window.locator('[data-id="terminal-reload"] .terminal-node')
      await expect(terminal).toBeVisible()
      await expect.poll(() => readRuntimeSessionId(window, 'terminal-reload')).toBeTruthy()
      const initialSessionId = await readRuntimeSessionId(window, 'terminal-reload')
      expect(initialSessionId).not.toBeNull()
      await window.evaluate(() => {
        const testWindow = window as MetadataTestWindow
        testWindow.__opencoveTerminalAgentMetadata = []
        window.opencoveApi.pty.onMetadata(event => {
          testWindow.__opencoveTerminalAgentMetadata?.push(event)
        })
      })
      const readCapturedEvents = async () =>
        await window.evaluate(
          () => (window as MetadataTestWindow).__opencoveTerminalAgentMetadata ?? [],
        )

      await terminal.locator('.xterm-helper-textarea').click()
      await window.keyboard.type('codex')
      await window.keyboard.press('Enter')
      await expectOverlayStubReady(terminal, 'codex')
      await expect
        .poll(async () => (await readCapturedEvents()).some(hasVerifiedTerminalAgentMetadata))
        .toBe(true)
      const capturedEvents = await readCapturedEvents()
      expect(capturedEvents).toContainEqual(
        expect.objectContaining({
          sessionId: initialSessionId,
          resumeSessionId: expect.any(String),
          terminalAgentActivity: expect.objectContaining({
            provider: 'codex',
            identityAuthority: 'provider_session_start',
          }),
        }),
      )
      const sessionStartEvent = capturedEvents.find(hasVerifiedTerminalAgentMetadata)
      expect(sessionStartEvent).toBeDefined()
      if (!sessionStartEvent) {
        throw new Error('Expected complete terminal agent metadata after readiness')
      }
      expect(sessionStartEvent.sessionId).toBe(initialSessionId)
      expect(sessionStartEvent.resumeSessionId).not.toBeNull()
      expect(sessionStartEvent.terminalAgentActivity).toMatchObject({
        provider: 'codex',
        identityAuthority: 'provider_session_start',
      })
      await window.keyboard.type(overlayAdvanceSentinel)
      await expect(terminal.locator('.terminal-node__status')).toHaveText('Standby')
      await expect
        .poll(async () => (await readPersistedNode(window, 'terminal-reload'))?.scrollback ?? '')
        .toContain('[opencove-test-overlay] codex ready')
      const persistedBeforeReload = await readPersistedNode(window, 'terminal-reload')
      expect(persistedBeforeReload).toMatchObject({
        id: 'terminal-reload',
        kind: 'terminal',
        sessionId: initialSessionId,
        agent: { provider: 'codex' },
      })

      await window.reload({ waitUntil: 'domcontentloaded' })

      const restoredTerminal = window.locator('[data-id="terminal-reload"] .terminal-node')
      const restoredSidebarItem = window.locator(
        '[data-testid="workspace-agent-item-workspace-overlay-reload-terminal-reload"]',
      )
      await expect(restoredTerminal).toBeVisible()
      await expect(restoredSidebarItem).toBeVisible()
      await expect(restoredTerminal.locator('.terminal-node__status')).toHaveText('Standby')
      await expect(restoredSidebarItem).toContainText('Standby')
      expect(await readRuntimeSessionId(window, 'terminal-reload')).toBe(initialSessionId)
      expect(await readPersistedNode(window, 'terminal-reload')).toMatchObject({
        id: 'terminal-reload',
        kind: 'terminal',
        sessionId: initialSessionId,
        scrollback: persistedBeforeReload?.scrollback,
        agent: { provider: 'codex' },
      })
    } finally {
      await electronApp.close()
      await rm(commandDirectory, { recursive: true, force: true })
      await rm(executionDirectory, { recursive: true, force: true })
    }
  })

  test('recognizes and drops back in both space-internal and root-canvas terminals', async () => {
    const commandDirectory = await createAgentCommandPath()
    await mkdir(testWorkspacePath, { recursive: true })
    const spaceExecutionDirectory = await mkdtemp(
      path.join(testWorkspacePath, 'agent-overlay-space-'),
    )
    const rootExecutionDirectory = await mkdtemp(
      path.join(testWorkspacePath, 'agent-overlay-root-'),
    )
    const { electronApp, window } = await launchApp({
      windowMode: 'offscreen',
      env: {
        PATH: `${commandDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
        OPENCOVE_TEST_CLAUDE_HOOK_INSTALL_FAILURE: '0',
        OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
      },
    })

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-overlay',
        workspaces: [
          {
            id: 'workspace-overlay',
            name: 'workspace-overlay',
            path: testWorkspacePath,
            activeSpaceId: null,
            nodes: [
              {
                id: 'terminal-space',
                title: 'Space terminal',
                position: { x: 180, y: 160 },
                width: 520,
                height: 400,
                kind: 'terminal',
                executionDirectory: spaceExecutionDirectory,
              },
              {
                id: 'terminal-root',
                title: 'Root terminal',
                position: { x: 820, y: 160 },
                width: 520,
                height: 400,
                kind: 'terminal',
                executionDirectory: rootExecutionDirectory,
              },
            ],
            spaces: [
              {
                id: 'space-overlay',
                name: 'Overlay space',
                directoryPath: spaceExecutionDirectory,
                nodeIds: ['terminal-space'],
                rect: { x: 120, y: 100, width: 620, height: 520 },
              },
            ],
          },
        ],
      })

      await runOverlayLifecycle({
        window,
        nodeId: 'terminal-space',
        terminal: window.locator('[data-id="terminal-space"] .terminal-node'),
      })
      await runOverlayLifecycle({
        window,
        nodeId: 'terminal-root',
        terminal: window.locator('[data-id="terminal-root"] .terminal-node'),
      })
    } finally {
      await electronApp.close()
      await rm(commandDirectory, { recursive: true, force: true })
      await rm(spaceExecutionDirectory, { recursive: true, force: true })
      await rm(rootExecutionDirectory, { recursive: true, force: true })
    }
  })
})
