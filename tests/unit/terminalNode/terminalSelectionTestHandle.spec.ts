import { registerTerminalSelectionTestHandle } from '@contexts/workspace/presentation/renderer/components/terminalNode/testHarness'
import {
  hasPendingDetachedTerminalRendererReadForTests,
  readTerminalRenderDimensionsSafely,
} from '@contexts/workspace/presentation/renderer/components/terminalNode/renderServiceSafety'

function terminalWithSize(
  cols: number,
  rows: number,
): Parameters<typeof registerTerminalSelectionTestHandle>[1] {
  return {
    clearSelection: () => undefined,
    getSelection: () => '',
    hasSelection: () => false,
    selectAll: () => undefined,
    cols,
    rows,
    element: null,
    scrollToBottom: () => undefined,
  } as Parameters<typeof registerTerminalSelectionTestHandle>[1]
}

describe('terminal selection test handle ownership', () => {
  it('leaves an injected detached-renderer read armed for production code', () => {
    const nodeId = 'detached-renderer-terminal'
    const terminal = terminalWithSize(80, 24)
    const dispose = registerTerminalSelectionTestHandle(nodeId, terminal)

    expect(window.__opencoveTerminalSelectionTestApi?.simulateDetachedRendererOnce(nodeId)).toBe(
      true,
    )
    expect(hasPendingDetachedTerminalRendererReadForTests(terminal as never)).toBe(true)
    expect(readTerminalRenderDimensionsSafely(terminal as never)).toBeNull()
    expect(hasPendingDetachedTerminalRendererReadForTests(terminal as never)).toBe(false)

    dispose()
  })

  it('does not let an older registration cleanup delete its replacement', () => {
    const nodeId = 'replacement-owned-terminal'
    const replacementOwnedTerminal = terminalWithSize(100, 30)
    const disposeOld = registerTerminalSelectionTestHandle(nodeId, replacementOwnedTerminal)
    const disposeCurrent = registerTerminalSelectionTestHandle(nodeId, replacementOwnedTerminal)

    disposeOld()

    expect(window.__opencoveTerminalSelectionTestApi?.getSize(nodeId)).toEqual({
      cols: 100,
      rows: 30,
    })

    disposeCurrent()
    expect(window.__opencoveTerminalSelectionTestApi?.getSize(nodeId)).toBeNull()
  })
})
