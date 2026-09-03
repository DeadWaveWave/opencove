import { registerTerminalSelectionTestHandle } from '@contexts/workspace/presentation/renderer/components/terminalNode/testHarness'

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
