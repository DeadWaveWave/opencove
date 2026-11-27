import { act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  A,
  B,
  commandsOf,
  controls,
  installCanvasHarnessHooks,
  latest,
  mount,
  noteNode,
  observe,
  reactFlow,
} from '../../support/canvasNodeCommandsHarness'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import type { CanvasNodeCommands } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeCommands'
import {
  readWorkspaceDocument,
  registerWorkspaceDocumentPersistFlush,
} from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import { setDocumentNodes } from '../../support/documentNodes'

// S7 of #647: the window family, and the note and website commands, called through the real canvas
// (the harness is `tests/support/canvasNodeCommandsHarness.tsx`).

installCanvasHarnessHooks()

describe('window.focusForInteraction reads the settings when it runs', () => {
  it('uses the zoom of the settings at the call, on the command that was made before they changed', async () => {
    useAppStore.setState(state => ({
      agentSettings: { ...state.agentSettings, focusNodeOnClick: true, focusNodeTargetZoom: 0.5 },
    }))
    await mount()
    const commands = commandsOf()

    act(() => commands.window.focusForInteraction('a'))
    expect(reactFlow.setCenter).toHaveBeenLastCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({ zoom: 0.5 }),
    )

    // A tick of the zoom slider: the settings change, the command object does not.
    await observe(() => {
      useAppStore.setState(state => ({
        agentSettings: { ...state.agentSettings, focusNodeTargetZoom: 0.9 },
      }))
    })
    expect(commandsOf()).toBe(commands)

    act(() => commands.window.focusForInteraction('a'))
    expect(reactFlow.setCenter).toHaveBeenLastCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({ zoom: 0.9 }),
    )
    expect(reactFlow.setCenter).toHaveBeenCalledTimes(2)
  })

  it('does nothing while "focus on click" is off, and starts again when it is turned on', async () => {
    useAppStore.setState(state => ({
      agentSettings: { ...state.agentSettings, focusNodeOnClick: false },
    }))
    await mount()
    const commands = commandsOf()

    act(() => commands.window.focusForInteraction('a'))
    expect(reactFlow.setCenter).not.toHaveBeenCalled()

    await observe(() => {
      useAppStore.setState(state => ({
        agentSettings: { ...state.agentSettings, focusNodeOnClick: true },
      }))
    })
    act(() => commands.window.focusForInteraction('a'))
    expect(reactFlow.setCenter).toHaveBeenCalledTimes(1)
  })

  it('centres on the window of its own workspace while another is displayed', async () => {
    useAppStore.setState(state => ({
      agentSettings: { ...state.agentSettings, focusNodeOnClick: true },
    }))
    await mount()
    const commandsOfA = commandsOf()
    await observe(() => controls.showWorkspace(B))
    reactFlow.setCenter.mockClear()
    // `a` sits at x 0 in A and in B; move it in A only.
    act(() => {
      setDocumentNodes(A, [noteNode('a', 'a-text', 4000), noteNode('b', 'b-text', 600)])
    })

    act(() => commandsOfA.window.focusForInteraction('a'))

    // The centre is A's node (x 4000 + half its width), not B's (x 0).
    expect(reactFlow.setCenter).toHaveBeenCalledWith(4150, expect.any(Number), expect.anything())
  })
})

describe('a command of workspace A that runs after the switch to B writes A (Decision 4)', () => {
  const noteText = (workspaceId: string, nodeId: string) => {
    const node = readWorkspaceDocument(workspaceId)?.nodes.find(
      candidate => candidate.id === nodeId,
    )
    return node?.data.note?.text
  }

  it('note.updateText writes the workspace of the node that made it', async () => {
    await mount()
    const commandsOfA = commandsOf()
    await observe(() => controls.showWorkspace(B))
    expect(latest().params.workspacePath).toBe(`/tmp/${B}`)

    act(() => commandsOfA.note.updateText('a', 'late text'))

    expect(noteText(A, 'a')).toBe('late text')
    expect(noteText(B, 'a')).toBe('B-text')
  })

  it('window.resize writes the workspace of the node that made it', async () => {
    await mount()
    const commandsOfA = commandsOf()
    const widthOf = (workspaceId: string) =>
      readWorkspaceDocument(workspaceId)?.nodes.find(node => node.id === 'a')?.data.width
    const widthInB = widthOf(B)
    await observe(() => controls.showWorkspace(B))

    act(() =>
      commandsOfA.window.resize('a', {
        position: { x: 0, y: 0 },
        size: { width: 520, height: 420 },
      }),
    )

    expect(widthOf(A)).toBe(520)
    expect(widthOf(B)).toBe(widthInB)
  })

  it('a command of B writes B after the switch, not A', async () => {
    await mount()
    await observe(() => controls.showWorkspace(B))

    act(() => commandsOf().note.updateText('a', 'in B'))

    expect(noteText(B, 'a')).toBe('in B')
    expect(noteText(A, 'a')).toBe('a-text')
  })
})

describe('the window commands reach the confirmation, the node store and the document', () => {
  it('requestDelete opens the confirmation for the windows the document holds, and writes no document', async () => {
    await mount()
    const documentBefore = readWorkspaceDocument(A)!

    await act(async () => commandsOf().window.requestDelete(['a', 'gone', 'b']))

    expect(latest().readUi().nodeDeleteConfirmation).toMatchObject({ nodeIds: ['a', 'b'] })
    expect(readWorkspaceDocument(A)!.nodes).toBe(documentBefore.nodes)
  })

  it('close closes a window of the document, requests one flush, and leaves the others', async () => {
    const flushes = vi.fn()
    const unregister = registerWorkspaceDocumentPersistFlush(flushes)
    await mount()

    await act(async () => commandsOf().window.close('b'))
    unregister()

    expect(readWorkspaceDocument(A)!.nodes.map(node => node.id)).toEqual(['a', 'w'])
    expect(flushes).toHaveBeenCalledTimes(1)
  })

  // The flush follows a real change only: a website write of a window the document holds still
  // requests one (the guard of the `didChange` pattern).
  it.each([
    [
      'website.updateUrl',
      (c: CanvasNodeCommands) => c.website.updateUrl('w', 'https://other.example'),
    ],
    ['website.setPinned', (c: CanvasNodeCommands) => c.website.setPinned('w', true)],
    ['website.setSession', (c: CanvasNodeCommands) => c.website.setSession('w', 'incognito', null)],
    ['website.setMode', (c: CanvasNodeCommands) => c.website.setMode('w', 'native')],
    [
      'website.setFullscreen',
      (c: CanvasNodeCommands) =>
        c.website.setFullscreen(
          'w',
          { position: { x: 0, y: 0 }, size: { width: 800, height: 600 } },
          null,
          true,
        ),
    ],
    [
      'window.setLabelColorOverride',
      (c: CanvasNodeCommands) => c.window.setLabelColorOverride(['b'], 'green'),
    ],
  ])('%s of a window the document holds requests one flush', async (_name, call) => {
    const flushes = vi.fn()
    const unregister = registerWorkspaceDocumentPersistFlush(flushes)
    await mount()
    flushes.mockClear()

    await act(async () => call(commandsOf()))
    unregister()

    expect(flushes).toHaveBeenCalledTimes(1)
  })

  it('note.updateText, website.setPinned and window.setLabelColorOverride write the window they name', async () => {
    await mount()
    const commands = commandsOf()

    act(() => {
      commands.note.updateText('a', 'edited')
      commands.website.setPinned('w', true)
      commands.window.setLabelColorOverride(['b'], 'green')
    })

    const nodes = readWorkspaceDocument(A)!.nodes
    expect(nodes.find(node => node.id === 'a')?.data.note?.text).toBe('edited')
    expect(nodes.find(node => node.id === 'w')?.data.website?.pinned).toBe(true)
    expect(nodes.find(node => node.id === 'b')?.data.labelColorOverride).toBe('green')
  })
})
