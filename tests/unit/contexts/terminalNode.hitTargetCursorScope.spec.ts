import { describe, expect, it, vi } from 'vitest'
import {
  registerTerminalHitTargetCursorScope,
  resolveTerminalHitTargetCursor,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/hitTargetCursorScope'

function createClassList(classes: string[]): Pick<DOMTokenList, 'contains'> {
  const classSet = new Set(classes)
  return {
    contains: token => classSet.has(token),
  }
}

describe('terminal hit target cursor scope', () => {
  it('defaults to text when xterm is in text input mode', () => {
    expect(resolveTerminalHitTargetCursor(createClassList([]))).toBe('text')
  })

  it('uses default when xterm mouse events are enabled', () => {
    expect(resolveTerminalHitTargetCursor(createClassList(['enable-mouse-events']))).toBe('default')
  })

  it('prefers pointer when xterm exposes pointer cursor state', () => {
    expect(resolveTerminalHitTargetCursor(createClassList(['xterm-cursor-pointer']))).toBe(
      'pointer',
    )
  })

  it('does not spam workspace canvas attributes when pointer position is stable', () => {
    const workspaceCanvas = document.createElement('div')
    workspaceCanvas.className = 'workspace-canvas'

    const container = document.createElement('div')
    container.className = 'terminal-node__terminal'
    // happy-dom returns a zero rect by default; override to a predictable hit test area.
    container.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 200,
        bottom: 200,
      }) as DOMRect

    const xterm = document.createElement('div')
    xterm.className = 'xterm focus'
    container.appendChild(xterm)
    workspaceCanvas.appendChild(container)
    document.body.appendChild(workspaceCanvas)

    const setAttributeSpy = vi.spyOn(workspaceCanvas, 'setAttribute')

    const dispose = registerTerminalHitTargetCursorScope({
      container,
      ownerId: 'test-owner',
    })

    const createPointerMove = (clientX: number, clientY: number) => {
      const options = { clientX, clientY, bubbles: true }
      return typeof PointerEvent === 'function'
        ? new PointerEvent('pointermove', options)
        : new MouseEvent('pointermove', options)
    }

    window.dispatchEvent(createPointerMove(80, 80))
    window.dispatchEvent(createPointerMove(80, 80))
    window.dispatchEvent(createPointerMove(80, 80))

    expect(workspaceCanvas.getAttribute('data-cove-terminal-hit-target-active')).toBe('true')
    expect(workspaceCanvas.getAttribute('data-cove-terminal-hit-target-cursor')).toBe('text')
    expect(workspaceCanvas.getAttribute('data-cove-terminal-hit-target-owner')).toBe('test-owner')
    expect(setAttributeSpy).toHaveBeenCalledTimes(3)

    dispose()
    setAttributeSpy.mockRestore()
  })
})
