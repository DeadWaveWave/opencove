import React, { useLayoutEffect } from 'react'
import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CanvasUiCommands } from '../../../src/contexts/workspace/presentation/renderer/store/canvasStore.ui'
import type {
  CanvasInteractionCommands,
  CanvasInteractionState,
} from '../../../src/contexts/workspace/presentation/renderer/store/canvasStore.interaction'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import {
  CanvasStoreProvider,
  useCanvasDocumentCommands,
  useCanvasInteraction,
  useCanvasInteractionCommands,
  useCanvasSelection,
  useCanvasSelectionCommands,
  useCanvasUi,
  useCanvasUiCommands,
  useReadCanvasDocument,
  useReadCanvasInteraction,
  useReadCanvasUi,
} from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import type { WorkspaceSpaceState } from '../../../src/contexts/workspace/presentation/renderer/types'
import { createCanvasDocumentHarness } from '../../support/canvasDocumentHarness'
import { createSpace } from '../../support/canvasSelectionFixtures'
import { pixelNode } from './workspacePixelLayer.fixtures'

// Counts the listeners that are subscribed to a canvas store right now.
const subscriptions = vi.hoisted(() => ({ active: 0 }))

vi.mock('zustand/vanilla', async importOriginal => {
  const actual = await importOriginal<typeof import('zustand/vanilla')>()
  const count = <S extends { subscribe: (listener: never) => () => void }>(store: S): S => {
    const subscribe = store.subscribe
    store.subscribe = (listener: never) => {
      subscriptions.active += 1
      const unsubscribe = subscribe(listener)
      let released = false
      return () => {
        if (!released) {
          released = true
          subscriptions.active -= 1
        }
        unsubscribe()
      }
    }
    return store
  }
  const createStore = ((initializer?: never) =>
    initializer === undefined
      ? (next: never) => count(actual.createStore(next))
      : count(actual.createStore(initializer))) as unknown as typeof actual.createStore
  return { ...actual, createStore }
})

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

const selectMagneticSnappingEnabled = (interaction: CanvasInteractionState) =>
  interaction.magneticSnappingEnabled
const selectSelectionDraft = (interaction: CanvasInteractionState) => interaction.selectionDraft

const DRAFT = { startX: 1, startY: 2, currentX: 3, currentY: 4, phase: 'active' } as const

// What a node gesture shows: nothing, until a drag frame writes it.
const NO_GESTURE = { liveNodes: null, snapGuides: null, nodeDragFramePreview: null }
const FRAME: Parameters<CanvasInteractionCommands['publishLiveNodes']>[0] = new Map([
  ['a', { position: { x: 0, y: 30 }, dragging: true }],
])
const GUIDES = [{ kind: 'v', x: 1, y1: 0, y2: 10 }] as const
const PREVIEW = new Map([['space-1', { x: 0, y: 0, width: 10, height: 10 }]])
const selectLiveNodes = (interaction: CanvasInteractionState) => interaction.liveNodes
const selectSnapGuides = (interaction: CanvasInteractionState) => interaction.snapGuides

describe('CanvasStoreProvider interaction slice', () => {
  function renderToggleProbe(workspaceId: string) {
    const toggles: boolean[] = []
    const drafts: unknown[] = []
    let commands: CanvasInteractionCommands | null = null
    let read: (() => CanvasInteractionState) | null = null
    function Probe(): null {
      toggles.push(useCanvasInteraction(selectMagneticSnappingEnabled))
      drafts.push(useCanvasInteraction(selectSelectionDraft))
      commands = useCanvasInteractionCommands()
      read = useReadCanvasInteraction()
      return null
    }
    const tree = (id: string) => (
      <CanvasStoreProvider workspaceId={id}>
        <Probe />
      </CanvasStoreProvider>
    )
    const view = render(tree(workspaceId))
    return {
      toggles,
      drafts,
      commands: () => commands as unknown as CanvasInteractionCommands,
      read: () => (read as unknown as () => CanvasInteractionState)(),
      rerender: (id: string) => view.rerender(tree(id)),
      unmount: () => view.unmount(),
    }
  }

  it('starts a new workspace id with no marquee in the first render and carries the toggle', () => {
    const probe = renderToggleProbe('workspace-a')
    act(() => {
      probe.commands().setSelectionDraft(DRAFT)
      probe.commands().toggleMagneticSnapping()
    })
    expect(probe.toggles.at(-1)).toBe(false)
    expect(probe.drafts.at(-1)).toEqual(DRAFT)

    const rendersBeforeSwitch = probe.toggles.length
    probe.rerender('workspace-b')

    expect(probe.toggles.length).toBeGreaterThan(rendersBeforeSwitch)
    // No render under the new id saw the old store's marquee or lost the toggle.
    expect(probe.drafts.slice(rendersBeforeSwitch).every(draft => draft === null)).toBe(true)
    expect(probe.toggles.slice(rendersBeforeSwitch).every(enabled => !enabled)).toBe(true)
    expect(probe.read()).toEqual({
      ...NO_GESTURE,
      selectionDraft: null,
      magneticSnappingEnabled: false,
    })
  })

  // The overlay, the guides and the preview of a gesture belong to the workspace it ran in: the
  // store of the new id is new, so none of them reaches it (#738, Lifecycle).
  it('starts a new workspace id with no overlay, guides or preview in the first render', () => {
    const probe = renderToggleProbe('workspace-a')
    act(() => {
      probe.commands().publishLiveNodes(FRAME)
      probe.commands().setSnapGuides([...GUIDES])
      probe.commands().setNodeDragFramePreview(PREVIEW)
      probe.commands().toggleMagneticSnapping()
    })
    expect(probe.read()).toMatchObject({
      liveNodes: FRAME,
      snapGuides: GUIDES,
      nodeDragFramePreview: PREVIEW,
    })

    probe.rerender('workspace-b')

    expect(probe.read()).toEqual({
      liveNodes: null,
      snapGuides: null,
      nodeDragFramePreview: null,
      selectionDraft: null,
      magneticSnappingEnabled: false,
    })
  })

  it('carries a toggle that is on as well as one that is off, through every switch', () => {
    const probe = renderToggleProbe('workspace-a')
    probe.rerender('workspace-b')
    expect(probe.read().magneticSnappingEnabled).toBe(true)

    act(() => probe.commands().toggleMagneticSnapping())
    probe.rerender('workspace-c')
    probe.rerender('workspace-a')

    // A switch back to an earlier id is a new store too, and it still carries the last value.
    expect(probe.read().magneticSnappingEnabled).toBe(false)
    expect(probe.read().selectionDraft).toBeNull()
  })

  it('keeps the toggle across rerenders with the same workspace id', () => {
    const probe = renderToggleProbe('workspace-a')
    act(() => probe.commands().toggleMagneticSnapping())

    probe.rerender('workspace-a')

    expect(probe.read().magneticSnappingEnabled).toBe(false)
  })

  describe('useCanvasInteraction', () => {
    it('returns the current value and updates on a write', () => {
      const probe = renderToggleProbe('workspace-a')
      expect(probe.toggles.at(-1)).toBe(true)
      expect(probe.drafts.at(-1)).toBeNull()

      act(() => probe.commands().toggleMagneticSnapping())
      expect(probe.toggles.at(-1)).toBe(false)

      act(() => probe.commands().setSelectionDraft(DRAFT))
      expect(probe.drafts.at(-1)).toEqual(DRAFT)
    })

    it('does not render when the store notifies a write that leaves the selected value as it was', () => {
      const toggles: boolean[] = []
      let commands: CanvasInteractionCommands | null = null
      function ToggleOnly(): null {
        toggles.push(useCanvasInteraction(selectMagneticSnappingEnabled))
        commands = useCanvasInteractionCommands()
        return null
      }
      render(
        <CanvasStoreProvider workspaceId="workspace-a">
          <ToggleOnly />
        </CanvasStoreProvider>,
      )
      const rendersBefore = toggles.length

      // The marquee changes, so the store notifies; the toggle this subscriber selects does not.
      act(() => (commands as unknown as CanvasInteractionCommands).setSelectionDraft(DRAFT))

      expect(toggles).toHaveLength(rendersBefore)
    })

    // The selector contract (#738): a subscriber re-renders for its own field and for no other.
    it('does not render for a write to another field of the slice, and renders for its own', () => {
      const lives: unknown[] = []
      const guides: unknown[] = []
      let commands: CanvasInteractionCommands | null = null
      function LiveOnly(): null {
        lives.push(useCanvasInteraction(selectLiveNodes))
        return null
      }
      function GuidesOnly(): null {
        guides.push(useCanvasInteraction(selectSnapGuides))
        commands = useCanvasInteractionCommands()
        return null
      }
      render(
        <CanvasStoreProvider workspaceId="workspace-a">
          <LiveOnly />
          <GuidesOnly />
        </CanvasStoreProvider>,
      )
      const write = (action: (commands: CanvasInteractionCommands) => void) =>
        act(() => action(commands as unknown as CanvasInteractionCommands))
      const livesBefore = lives.length
      const guidesBefore = guides.length

      write(c => c.setSnapGuides([...GUIDES]))
      write(c => c.setNodeDragFramePreview(PREVIEW))
      write(c => c.setSelectionDraft(DRAFT))
      write(c => c.toggleMagneticSnapping())
      expect(lives).toHaveLength(livesBefore)
      expect(guides.length).toBeGreaterThan(guidesBefore)

      const guidesBeforeFrame = guides.length
      write(c => c.publishLiveNodes(FRAME))
      expect(lives.at(-1)).toBe(FRAME)
      expect(guides).toHaveLength(guidesBeforeFrame)
    })

    it('returns the new store value in the render that receives a new workspace id', () => {
      const probe = renderToggleProbe('workspace-a')
      act(() => probe.commands().setSelectionDraft(DRAFT))
      const rendersBeforeSwitch = probe.drafts.length

      probe.rerender('workspace-b')

      // The first render under the new id already shows the new store's empty marquee.
      expect(probe.drafts[rendersBeforeSwitch]).toBeNull()
      expect(probe.drafts.at(-1)).toBeNull()
      act(() => probe.commands().setSelectionDraft({ ...DRAFT, currentX: 9 }))
      expect(probe.drafts.at(-1)).toEqual({ ...DRAFT, currentX: 9 })
    })

    it('stops listening to the store of the old workspace after a switch', () => {
      const probe = renderToggleProbe('workspace-a')
      const commandsOfA = probe.commands()
      probe.rerender('workspace-b')
      const rendersAfterSwitch = probe.drafts.length

      act(() => commandsOfA.setSelectionDraft(DRAFT))

      expect(probe.drafts).toHaveLength(rendersAfterSwitch)
      expect(probe.drafts.at(-1)).toBeNull()
    })

    it('reads a write made between its render and its subscription', () => {
      const seen: unknown[] = []
      function Writer(): null {
        const commands = useCanvasInteractionCommands()
        // This effect runs before the subscriber's, which has not subscribed yet.
        useLayoutEffect(() => commands.setSelectionDraft(DRAFT), [commands])
        return null
      }
      function Subscriber(): null {
        seen.push(useCanvasInteraction(selectSelectionDraft))
        return null
      }

      render(
        <CanvasStoreProvider workspaceId="workspace-a">
          <Writer />
          <Subscriber />
        </CanvasStoreProvider>,
      )

      expect(seen.at(-1)).toEqual(DRAFT)
    })

    it('subscribes once and unsubscribes on unmount', () => {
      const before = subscriptions.active
      const probe = renderToggleProbe('workspace-a')
      // Two selectors, so two subscriptions of the probe; none of them is renewed by a rerender.
      expect(subscriptions.active).toBe(before + 2)
      probe.rerender('workspace-a')
      act(() => probe.commands().toggleMagneticSnapping())
      expect(subscriptions.active).toBe(before + 2)

      probe.unmount()

      expect(subscriptions.active).toBe(before)
    })

    it('replaces its subscription with the new store when the workspace changes', () => {
      const before = subscriptions.active
      const probe = renderToggleProbe('workspace-a')
      probe.rerender('workspace-b')

      expect(subscriptions.active).toBe(before + 2)
      probe.unmount()
      expect(subscriptions.active).toBe(before)
    })
  })
})
