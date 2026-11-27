import { act, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  A,
  commandsOf,
  installCanvasHarnessHooks,
  ipc,
  latest,
  mount,
  observe,
  reactFlow,
  scheduledScrollbacks,
} from '../../support/canvasNodeCommandsHarness'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import type { WiredCanvasNodeCommands } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeCommands'
import {
  readWorkspaceDocument,
  registerWorkspaceDocumentPersistFlush,
} from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import { useScrollbackStore } from '../../../src/contexts/workspace/presentation/renderer/store/useScrollbackStore'

// S7 of #647: a command called with an id the document no longer holds writes, flushes, stores,
// launches and opens nothing, whatever the family. One row per command, through the real canvas
// (the harness is `tests/support/canvasNodeCommandsHarness.tsx`).

installCanvasHarnessHooks()

describe('a command called with an id the document no longer holds writes nothing about it', () => {
  // The window, terminal, note and website families, one row per command. `clearSelection` has no id.
  // Every row also reads the selection and the React Flow flag: they stay as they were (Invariant 2).
  const table: Array<[string, (commands: WiredCanvasNodeCommands) => unknown]> = [
    ['window.select', c => c.window.select('gone')],
    ['window.select with toggle', c => c.window.select('gone', { toggle: true })],
    ['window.close', c => c.window.close('gone')],
    ['window.requestDelete', c => c.window.requestDelete(['gone'])],
    [
      'window.resize',
      c => c.window.resize('gone', { position: { x: 0, y: 0 }, size: { width: 500, height: 400 } }),
    ],
    ['window.focusForInteraction', c => c.window.focusForInteraction('gone')],
    ['window.setLabelColorOverride', c => c.window.setLabelColorOverride(['gone'], 'blue')],
    // The terminal family (PR 5): nothing is written, stored, launched or listed for the window.
    ['terminal.updateScrollback', c => c.terminal.updateScrollback('gone', 'output')],
    ['terminal.recordCommandRun', c => c.terminal.recordCommandRun('gone', 'ls -la', 1)],
    ['terminal.clearAgentOverlay', c => c.terminal.clearAgentOverlay('gone', 1)],
    ['terminal.renameTitle', c => c.terminal.renameTitle('gone', 'title')],
    ['terminal.copyLastAgentMessage', c => c.terminal.copyLastAgentMessage('gone')],
    ['terminal.reloadAgentSession', c => c.terminal.reloadAgentSession('gone')],
    ['terminal.listAgentSessions', c => c.terminal.listAgentSessions('gone', 5)],
    [
      'terminal.switchAgentSession',
      c => c.terminal.switchAgentSession('gone', { sessionId: 'r', provider: 'codex' } as never),
    ],
    ['note.updateText', c => c.note.updateText('gone', 'text')],
    ['note.renameTitle', c => c.note.renameTitle('gone', 'title')],
    ['note.convertToTask', c => c.note.convertToTask('gone')],
    ['website.updateUrl', c => c.website.updateUrl('gone', 'https://other.example')],
    ['website.setPinned', c => c.website.setPinned('gone', true)],
    ['website.setSession', c => c.website.setSession('gone', 'incognito', null)],
    ['website.setMode', c => c.website.setMode('gone', 'native')],
    [
      'website.setFullscreen',
      c =>
        c.website.setFullscreen(
          'gone',
          { position: { x: 0, y: 0 }, size: { width: 800, height: 600 } },
          null,
          true,
        ),
    ],
  ]

  it.each(table)('%s', async (name, call) => {
    useAppStore.setState(state => ({
      agentSettings: { ...state.agentSettings, focusNodeOnClick: true },
    }))
    const notifications = vi.fn()
    const flushes = vi.fn()
    const unregister = registerWorkspaceDocumentPersistFlush(flushes)
    await mount()
    // Another window of the canvas stays selected: a write about the missing one must not touch it.
    await observe(() => void fireEvent.click(screen.getByTestId('select-a')))
    const commands = commandsOf()
    const { readSelection, readUi } = latest()
    expect(readSelection().nodeIds).toEqual(['a'])
    const documentBefore = readWorkspaceDocument(A)!
    const unsubscribe = useAppStore.subscribe(notifications)
    flushes.mockClear()
    // The canvas's own mount traffic is not the command's.
    Object.values(ipc).forEach(mock => mock.mockClear())

    await act(async () => {
      await call(commands)
    })
    unsubscribe()
    unregister()

    // The document: the same object, and no write reached the app store.
    expect(readWorkspaceDocument(A)!.nodes).toBe(documentBefore.nodes)
    expect(readWorkspaceDocument(A)!.spaces).toBe(documentBefore.spaces)
    expect(notifications).not.toHaveBeenCalled()
    // Nothing about the id: not even a request to persist.
    expect(flushes).not.toHaveBeenCalled()
    // The canvas store: the selection, the dialog, and the viewport are as they were.
    expect(readSelection().nodeIds).toEqual(['a'])
    expect(reactFlow.state.nodesSelectionActive).toBe(true)
    expect(readUi().nodeDeleteConfirmation).toBeNull()
    expect(reactFlow.setCenter).not.toHaveBeenCalled()
    // Outside the document: no IPC, and no scrollback stored or scheduled for the id.
    for (const [channel, mock] of Object.entries(ipc)) {
      expect(mock, channel).not.toHaveBeenCalled()
    }
    expect(useScrollbackStore.getState().scrollbackByNodeId).toEqual({})
    expect(scheduledScrollbacks).toEqual([])
  })
})
