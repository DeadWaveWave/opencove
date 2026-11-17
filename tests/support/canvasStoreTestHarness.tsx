import {
  render,
  renderHook,
  type RenderHookResult,
  type RenderResult,
} from '@testing-library/react'
import { useLayoutEffect, type ReactElement, type ReactNode } from 'react'
import {
  CanvasStoreProvider,
  useCanvasSelectionCommands,
  useCanvasUiCommands,
  useReadCanvasSelection,
  useReadCanvasUi,
} from '../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import type {
  CanvasSelectionCommands,
  CanvasSelectionState,
} from '../../src/contexts/workspace/presentation/renderer/store/canvasStore.selection'
import type {
  CanvasUiCommands,
  CanvasUiState,
} from '../../src/contexts/workspace/presentation/renderer/store/canvasStore.ui'
import type { ContextMenuState } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/types'

export const CANVAS_STORE_TEST_WORKSPACE_ID = 'test-workspace'

/** Provides a canvas store to a component under test that is rendered without `WorkspaceCanvas`. */
export function CanvasStoreTestProvider({
  children,
  workspaceId = CANVAS_STORE_TEST_WORKSPACE_ID,
}: {
  children: ReactNode
  workspaceId?: string
}): ReactElement {
  return <CanvasStoreProvider workspaceId={workspaceId}>{children}</CanvasStoreProvider>
}

export interface CanvasStoreProbe {
  readUi: () => CanvasUiState
  commands: CanvasUiCommands
  readSelection: () => CanvasSelectionState
  selection: CanvasSelectionCommands
}

function createProbe(): { Probe: () => null; capture: () => CanvasStoreProbe } {
  let probe: CanvasStoreProbe | null = null

  function Probe(): null {
    probe = {
      readUi: useReadCanvasUi(),
      commands: useCanvasUiCommands(),
      readSelection: useReadCanvasSelection(),
      selection: useCanvasSelectionCommands(),
    }
    return null
  }

  return {
    Probe,
    capture: () => {
      if (!probe) {
        throw new Error('canvas store probe did not render')
      }
      const captured = probe
      return {
        readUi: () => captured.readUi(),
        commands: captured.commands,
        readSelection: () => captured.readSelection(),
        selection: captured.selection,
      }
    },
  }
}

/** Renders `ui` inside a test store and returns the store's reader and commands. */
export function renderWithCanvasStore(ui: ReactElement): RenderResult & CanvasStoreProbe {
  const { Probe, capture } = createProbe()
  // The provider and probe are the wrapper, so `rerender(ui)` keeps the tree and its state.
  const result = render(ui, {
    wrapper: ({ children }) => (
      <CanvasStoreTestProvider>
        <Probe />
        {children}
      </CanvasStoreTestProvider>
    ),
  })
  return { ...result, ...capture() }
}

function OpenContextMenu({ menu }: { menu: ContextMenuState }): null {
  const commands = useCanvasUiCommands()
  useLayoutEffect(() => {
    commands.openContextMenu(menu)
  }, [commands, menu])
  return null
}

/** `renderHook` inside a test store; `contextMenu` opens that menu before the first test step. */
export function renderHookWithCanvasStore<Result, Props>(
  callback: (props: Props) => Result,
  options: { initialProps?: Props; contextMenu?: ContextMenuState } = {},
): RenderHookResult<Result, Props> & CanvasStoreProbe {
  const { Probe, capture } = createProbe()
  const { contextMenu } = options
  const result = renderHook(callback, {
    initialProps: options.initialProps,
    wrapper: ({ children }) => (
      <CanvasStoreTestProvider>
        <Probe />
        {contextMenu ? <OpenContextMenu menu={contextMenu} /> : null}
        {children}
      </CanvasStoreTestProvider>
    ),
  })
  return { ...result, ...capture() }
}
