import { afterEach, describe, expect, it } from 'vitest'
import { resolveTerminalNodeInteraction } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/interaction'

afterEach(() => {
  document.body.innerHTML = ''
})

function createTerminalNodeFixture(): {
  headerTitle: HTMLSpanElement
  dragOverlay: HTMLDivElement
  terminalSurface: HTMLDivElement
  terminalContent: HTMLDivElement
  resizer: HTMLButtonElement
} {
  const root = document.createElement('div')

  const header = document.createElement('div')
  header.className = 'terminal-node__header'
  const headerTitle = document.createElement('span')
  headerTitle.className = 'terminal-node__title'
  header.append(headerTitle)

  const terminalSurface = document.createElement('div')
  terminalSurface.className = 'terminal-node__terminal'
  const terminalContent = document.createElement('div')
  terminalContent.className = 'xterm'
  terminalSurface.append(terminalContent)

  const dragOverlay = document.createElement('div')
  dragOverlay.className = 'terminal-node__selected-drag-overlay'

  const resizer = document.createElement('button')
  resizer.className = 'terminal-node__resizer'

  root.append(header, terminalSurface, dragOverlay, resizer)
  document.body.append(root)

  return {
    headerTitle,
    dragOverlay,
    terminalSurface,
    terminalContent,
    resizer,
  }
}

describe('resolveTerminalNodeInteraction', () => {
  it('treats terminal surface clicks as focus-only interactions', () => {
    const { terminalSurface, terminalContent } = createTerminalNodeFixture()

    expect(resolveTerminalNodeInteraction(terminalSurface)).toEqual({
      normalizeViewport: true,
      selectNode: false,
    })
    expect(resolveTerminalNodeInteraction(terminalContent)).toEqual({
      normalizeViewport: true,
      selectNode: false,
    })
  })

  it('treats header clicks as selectable node interactions', () => {
    const { headerTitle } = createTerminalNodeFixture()

    expect(resolveTerminalNodeInteraction(headerTitle)).toEqual({
      normalizeViewport: false,
      selectNode: true,
    })
  })

  it('treats non-terminal surfaces as selectable node interactions', () => {
    const { dragOverlay } = createTerminalNodeFixture()

    expect(resolveTerminalNodeInteraction(dragOverlay)).toEqual({
      normalizeViewport: false,
      selectNode: true,
    })
  })

  it('ignores resizer and control targets', () => {
    const { resizer } = createTerminalNodeFixture()

    expect(resolveTerminalNodeInteraction(resizer)).toBeNull()
  })
})
