import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import {
  CanvasStoreProvider,
  useCanvasUiCommands,
  useReadCanvasUi,
} from '../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import type {
  CanvasUiCommands,
  CanvasUiState,
} from '../../src/contexts/workspace/presentation/renderer/store/canvasStore.ui'

export const CANVAS_STORE_TEST_WORKSPACE_ID = 'test-workspace'

/** Provides a canvas store to a component under test that is rendered without `WorkspaceCanvas`. */
export function CanvasStoreTestProvider({ children }: { children: ReactNode }): ReactElement {
  return (
    <CanvasStoreProvider workspaceId={CANVAS_STORE_TEST_WORKSPACE_ID}>
      {children}
    </CanvasStoreProvider>
  )
}

export interface CanvasStoreProbe {
  readUi: () => CanvasUiState
  commands: CanvasUiCommands
}

/** Renders `ui` inside a test store and returns the store's reader and commands. */
export function renderWithCanvasStore(ui: ReactElement): RenderResult & CanvasStoreProbe {
  let probe: CanvasStoreProbe | null = null

  function Probe(): null {
    probe = { readUi: useReadCanvasUi(), commands: useCanvasUiCommands() }
    return null
  }

  const result = render(
    <CanvasStoreTestProvider>
      <Probe />
      {ui}
    </CanvasStoreTestProvider>,
  )

  if (!probe) {
    throw new Error('canvas store probe did not render')
  }
  const captured: CanvasStoreProbe = probe
  return {
    ...result,
    readUi: () => captured.readUi(),
    commands: captured.commands,
  }
}
