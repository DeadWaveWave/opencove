import React from 'react'
import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CanvasUiCommands } from '../../../src/contexts/workspace/presentation/renderer/store/canvasStore.ui'
import {
  CanvasStoreProvider,
  useCanvasUi,
  useCanvasUiCommands,
  useReadCanvasUi,
} from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'

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
