import React from 'react'
import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CanvasUiCommands } from '../../../src/contexts/workspace/presentation/renderer/store/canvasStore.ui'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import {
  CanvasStoreProvider,
  useCanvasDocumentCommands,
  useCanvasSelection,
  useCanvasSelectionCommands,
  useCanvasUi,
  useCanvasUiCommands,
  useReadCanvasDocument,
  useReadCanvasUi,
} from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import type { WorkspaceSpaceState } from '../../../src/contexts/workspace/presentation/renderer/types'
import { createCanvasDocumentHarness } from '../../support/canvasDocumentHarness'
import { createSpace } from '../../support/canvasSelectionFixtures'
import { pixelNode } from './workspacePixelLayer.fixtures'

interface Recorder {
  menus: unknown[]
  commands: CanvasUiCommands | null
  readUi: ReturnType<typeof useReadCanvasUi> | null
}

function createProbe(recorder: Recorder): () => null {
  return function Probe(): null {
    recorder.menus.push(useCanvasUi(ui => ui.contextMenu))
    recorder.commands = useCanvasUiCommands()
    recorder.readUi = useReadCanvasUi()
    return null
  }
}

describe('CanvasStoreProvider', () => {
  it('keeps the store across rerenders with the same workspace id', () => {
    const recorder: Recorder = { menus: [], commands: null, readUi: null }
    const Probe = createProbe(recorder)
    const tree = (workspaceId: string) => (
      <CanvasStoreProvider workspaceId={workspaceId}>
        <Probe />
      </CanvasStoreProvider>
    )

    const { rerender } = render(tree('workspace-a'))
    const firstCommands = recorder.commands
    const firstReadUi = recorder.readUi

    act(() => {
      firstCommands?.openContextMenu({ kind: 'selection', x: 1, y: 2 })
    })
    expect(recorder.menus.at(-1)).toEqual({ kind: 'selection', x: 1, y: 2 })

    rerender(tree('workspace-a'))

    expect(recorder.commands).toBe(firstCommands)
    expect(recorder.readUi).toBe(firstReadUi)
    expect(recorder.menus.at(-1)).toEqual({ kind: 'selection', x: 1, y: 2 })
  })

  it('creates a new store in the first render under a new workspace id', () => {
    const recorder: Recorder = { menus: [], commands: null, readUi: null }
    const Probe = createProbe(recorder)
    const tree = (workspaceId: string) => (
      <CanvasStoreProvider workspaceId={workspaceId}>
        <Probe />
      </CanvasStoreProvider>
    )

    const { rerender } = render(tree('workspace-a'))
    const firstCommands = recorder.commands
    act(() => {
      firstCommands?.openContextMenu({ kind: 'selection', x: 1, y: 2 })
    })
    expect(recorder.menus.at(-1)).not.toBeNull()

    const rendersBeforeSwitch = recorder.menus.length
    rerender(tree('workspace-b'))

    // No render under the new id ever saw the old store's menu.
    expect(recorder.menus.slice(rendersBeforeSwitch).every(menu => menu === null)).toBe(true)
    expect(recorder.menus.length).toBeGreaterThan(rendersBeforeSwitch)
    expect(recorder.commands).not.toBe(firstCommands)
    expect(recorder.readUi?.().contextMenu).toBeNull()
  })

  it('starts a new workspace id with an empty selection in the first render', () => {
    const spaceIdsSeen: Array<readonly string[]> = []
    let selection: ReturnType<typeof useCanvasSelectionCommands> | null = null
    function SelectionProbe(): null {
      spaceIdsSeen.push(useCanvasSelection(state => state.spaceIds))
      selection = useCanvasSelectionCommands()
      return null
    }
    const tree = (workspaceId: string) => (
      <CanvasStoreProvider workspaceId={workspaceId}>
        <SelectionProbe />
      </CanvasStoreProvider>
    )

    const { rerender } = render(tree('workspace-a'))
    act(() => {
      selection?.setSpaceIds(['s'])
    })
    expect(spaceIdsSeen.at(-1)).toEqual(['s'])

    const rendersBeforeSwitch = spaceIdsSeen.length
    rerender(tree('workspace-b'))

    expect(spaceIdsSeen.length).toBeGreaterThan(rendersBeforeSwitch)
    expect(spaceIdsSeen[rendersBeforeSwitch]).toEqual([])
    expect(spaceIdsSeen.slice(rendersBeforeSwitch).every(ids => ids.length === 0)).toBe(true)
  })

  it('throws outside the provider', () => {
    const Probe = createProbe({ menus: [], commands: null, readUi: null })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(() => render(<Probe />)).toThrow('canvas store hooks need CanvasStoreProvider')
    } finally {
      consoleError.mockRestore()
    }
  })
})

describe('CanvasStoreProvider document reader and commands', () => {
  function spaceNamed(id: string): WorkspaceSpaceState {
    return createSpace(id, { x: 0, y: 0, width: 400, height: 300 })
  }

  // The harness seeds `workspace-a`; `workspace-b` is the workspace a switch would show.
  function seedTwoWorkspaces() {
    const harness = createCanvasDocumentHarness({
      workspaceId: 'workspace-a',
      nodes: [pixelNode({ title: 'a' })],
      spaces: [spaceNamed('space-a')],
    })
    useAppStore.setState(state => ({
      workspaces: [
        ...state.workspaces,
        { ...state.workspaces[0], id: 'workspace-b', spaces: [spaceNamed('space-b')], nodes: [] },
      ],
    }))
    return harness
  }

  interface DocumentProbe {
    read: ReturnType<typeof useReadCanvasDocument>
    commands: ReturnType<typeof useCanvasDocumentCommands>
  }

  function renderProbe(workspaceId: string) {
    const seen: DocumentProbe[] = []
    function Probe(): null {
      seen.push({ read: useReadCanvasDocument(), commands: useCanvasDocumentCommands() })
      return null
    }
    const tree = (id: string) => (
      <CanvasStoreProvider workspaceId={id}>
        <Probe />
      </CanvasStoreProvider>
    )
    const view = render(tree(workspaceId))
    return { seen, rerender: (id: string) => view.rerender(tree(id)) }
  }

  it('reads the committed document of the provider workspace', () => {
    seedTwoWorkspaces()
    const { seen } = renderProbe('workspace-b')

    expect(
      seen
        .at(-1)
        ?.read()
        .spaces.map(space => space.id),
    ).toEqual(['space-b'])
    expect(seen.at(-1)?.read().nodes).toEqual([])
  })

  it('keeps the reader and the commands across rerenders with the same id and changes them with a new id', () => {
    seedTwoWorkspaces()
    const { seen, rerender } = renderProbe('workspace-a')
    const first = seen.at(-1) as DocumentProbe

    rerender('workspace-a')
    expect(seen.at(-1)?.read).toBe(first.read)
    expect(seen.at(-1)?.commands).toBe(first.commands)

    rerender('workspace-b')
    expect(seen.at(-1)?.read).not.toBe(first.read)
    expect(seen.at(-1)?.commands).not.toBe(first.commands)
    expect(
      seen
        .at(-1)
        ?.read()
        .spaces.map(space => space.id),
    ).toEqual(['space-b'])
  })

  it('keeps a reader captured before a switch on the old workspace', () => {
    seedTwoWorkspaces()
    const { seen, rerender } = renderProbe('workspace-a')
    const readBeforeSwitch = (seen.at(-1) as DocumentProbe).read

    rerender('workspace-b')

    expect(readBeforeSwitch().spaces.map(space => space.id)).toEqual(['space-a'])
    expect(
      seen
        .at(-1)
        ?.read()
        .spaces.map(space => space.id),
    ).toEqual(['space-b'])
  })

  it('reads the store arrays themselves, not copies', () => {
    seedTwoWorkspaces()
    const { seen } = renderProbe('workspace-a')
    const [stored] = useAppStore.getState().workspaces

    const document = (seen.at(-1) as DocumentProbe).read()

    expect(document.spaces).toBe(stored.spaces)
    expect(document.nodes).toBe(stored.nodes)
  })

  it('reads an empty document, the same one every time, when the workspace is gone', () => {
    seedTwoWorkspaces()
    const { seen } = renderProbe('workspace-gone')
    const read = (seen.at(-1) as DocumentProbe).read

    expect(read().nodes).toEqual([])
    expect(read().spaces).toEqual([])
    expect(read()).toBe(read())
  })

  it('writes Spaces in one store update, flushes only when asked, and writes only its workspace', () => {
    const harness = seedTwoWorkspaces()
    const { seen } = renderProbe('workspace-a')
    const commands = (seen.at(-1) as DocumentProbe).commands
    const [, workspaceB] = useAppStore.getState().workspaces
    harness.notifications.mockClear()

    const written = commands.updateSpaces(spaces => [...spaces, spaceNamed('space-new')])

    expect(written.status).toBe('applied')
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(harness.flush).not.toHaveBeenCalled()
    expect(harness.readStoreDocument().spaces.map(space => space.id)).toEqual([
      'space-a',
      'space-new',
    ])
    expect(useAppStore.getState().workspaces[1]).toBe(workspaceB)

    commands.updateSpaces(spaces => spaces.slice(0, 1), { flush: true })
    expect(harness.flush).toHaveBeenCalledTimes(1)
  })

  it('writes nothing for a recipe that returns the same Spaces, and flushes when asked', () => {
    const harness = seedTwoWorkspaces()
    const { seen } = renderProbe('workspace-a')
    const commands = (seen.at(-1) as DocumentProbe).commands
    harness.notifications.mockClear()

    expect(commands.updateSpaces(spaces => spaces, { flush: true }).status).toBe('unchanged')

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.flush).toHaveBeenCalledTimes(1)
  })

  it('computes the recipe from the store at call time and reports a missing workspace', () => {
    const harness = seedTwoWorkspaces()
    const { seen } = renderProbe('workspace-a')
    const commands = (seen.at(-1) as DocumentProbe).commands
    useAppStore.setState(state => ({
      workspaces: state.workspaces.map(workspace =>
        workspace.id === 'workspace-a'
          ? { ...workspace, spaces: [...workspace.spaces, spaceNamed('space-late')] }
          : workspace,
      ),
    }))
    let seenByRecipe: string[] = []

    commands.updateSpaces(spaces => {
      seenByRecipe = spaces.map(space => space.id)
      return spaces
    })
    expect(seenByRecipe).toEqual(['space-a', 'space-late'])

    const gone = renderProbe('workspace-gone')
    harness.flush.mockClear()
    expect(
      (gone.seen.at(-1) as DocumentProbe).commands.updateSpaces(spaces => [...spaces], {
        flush: true,
      }),
    ).toEqual({ status: 'missing' })
    expect(harness.flush).not.toHaveBeenCalled()
  })

  it('requests the persist flush through the document module', () => {
    const harness = seedTwoWorkspaces()
    const { seen } = renderProbe('workspace-a')

    ;(seen.at(-1) as DocumentProbe).commands.requestPersistFlush()

    expect(harness.flush).toHaveBeenCalledTimes(1)
  })
})
