import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestViewportNodeInputFocus } from './requestViewportNodeInputFocus'

describe('requestViewportNodeInputFocus', () => {
  let frames: Map<number, FrameRequestCallback>
  let dispose: (() => void) | null = null

  beforeEach(() => {
    frames = new Map()
    let nextFrame = 1
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      const frame = nextFrame++
      frames.set(frame, callback)
      return frame
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(frame => {
      frames.delete(frame)
    })
    document.body.innerHTML =
      '<main class="workspace-canvas"><div class="react-flow__node" data-id="agent-1"></div></main>'
  })

  afterEach(() => {
    dispose?.()
    dispose = null
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  function flushFrame(): void {
    const pending = [...frames.values()]
    frames.clear()
    pending.forEach(callback => callback(0))
  }

  function mountTerminal(): HTMLTextAreaElement {
    const node = document.querySelector('.react-flow__node')!
    node.innerHTML =
      '<div class="terminal-node__terminal"><textarea class="xterm-helper-textarea"></textarea></div>'
    return node.querySelector('textarea')!
  }

  it('focuses the real terminal input once it mounts without selecting the window', () => {
    dispose = requestViewportNodeInputFocus('agent-1')
    flushFrame()
    const input = mountTerminal()

    flushFrame()

    expect(document.activeElement).toBe(input)
    expect(document.querySelector('.react-flow__node.selected')).toBeNull()
    expect(frames.size).toBe(0)
  })

  it('stops a delayed focus when the user interacts elsewhere', () => {
    dispose = requestViewportNodeInputFocus('agent-1')
    flushFrame()
    window.dispatchEvent(new Event('pointerdown'))
    const input = mountTerminal()

    flushFrame()

    expect(document.activeElement).not.toBe(input)
    expect(frames.size).toBe(0)
  })

  it('expires when no input appears and releases its frame', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0)
    dispose = requestViewportNodeInputFocus('agent-1')
    now.mockReturnValue(1001)

    flushFrame()

    expect(frames.size).toBe(0)
  })

  it('does not steal input from an open modal dialog', () => {
    const input = mountTerminal()
    const dialog = document.createElement('section')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    document.body.append(dialog)
    dispose = requestViewportNodeInputFocus('agent-1')

    flushFrame()
    expect(document.activeElement).not.toBe(input)
    dialog.remove()
    flushFrame()

    expect(document.activeElement).toBe(input)
  })
})
