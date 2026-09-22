import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWindowCollapseMotion } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/useWindowCollapseMotion'
import { useCollapseLayoutMotion } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/useCollapseLayoutMotion'
import { createSpace } from '../contexts/workspaceNodeProjection.testUtils'

interface PendingAnimation {
  finish: () => void
  cancel: ReturnType<typeof vi.fn>
}

const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
let animations: PendingAnimation[]
let media: MediaQueryList
let reducedMotion: boolean

beforeEach(() => {
  animations = []
  reducedMotion = false
  media = new EventTarget() as MediaQueryList
  Object.defineProperty(media, 'matches', { get: () => reducedMotion })
  vi.spyOn(window, 'matchMedia').mockReturnValue(media)
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: vi.fn(() => {
      let finish!: () => void
      let reject!: (reason: unknown) => void
      const finished = new Promise<void>((resolve, rejectPromise) => {
        finish = resolve
        reject = rejectPromise
      })
      const cancel = vi.fn(() => reject(new DOMException('Cancelled', 'AbortError')))
      animations.push({ finish, cancel })
      return { finished, cancel } as unknown as Animation
    }),
  })
})

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  if (originalAnimate) {
    Object.defineProperty(Element.prototype, 'animate', originalAnimate)
  } else {
    Reflect.deleteProperty(Element.prototype, 'animate')
  }
})

function windowScene() {
  const shell = document.createElement('div')
  shell.innerHTML = `
    <div class="cove-node-presentation__surface"></div>
    <div class="cove-node-presentation__runtime" style="width:640px;height:480px">
      <span class="cove-node-kind-icon"></span><span class="note-node__title">Draft</span>
    </div>
    <div class="cove-collapsed-window">
      <span class="cove-collapsed-window__icon"><svg></svg></span>
      <span class="cove-collapsed-window__title">Draft</span>
    </div>`
  document.body.append(shell)
  vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 420, 300))
  const ref = { current: shell }
  const hook = renderHook(
    ({ collapsed }) =>
      useWindowCollapseMotion(
        ref,
        collapsed,
        false,
        { width: 640, height: 480 },
        { width: 128, height: 112 },
        0,
      ),
    { initialProps: { collapsed: false } },
  )
  return { shell, ...hook }
}

describe('collapse animation lifecycle', () => {
  it('does not let a cancelled fold completion clear a newer unfold', async () => {
    const { shell, rerender } = windowScene()
    rerender({ collapsed: true })
    const folded = [...animations]
    expect(folded.length).toBeGreaterThan(0)
    expect(shell.dataset.coveCollapseMotion).toBe('collapse')
    rerender({ collapsed: false })
    const unfolded = animations.slice(folded.length)
    await act(async () => {
      await Promise.resolve()
    })
    expect(folded.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true)
    expect(unfolded.every(animation => animation.cancel.mock.calls.length === 0)).toBe(true)
    expect(shell.dataset.coveCollapseMotion).toBe('expand')
    await act(async () => {
      unfolded.forEach(animation => animation.finish())
    })
    expect(shell.dataset.coveCollapseMotion).toBeUndefined()
    expect(shell.querySelector('.cove-node-presentation__runtime')).toHaveStyle({
      width: '640px',
      height: '480px',
    })
  })

  it('cleans up all window effects on pointer interruption and unmount', async () => {
    const { shell, rerender, unmount } = windowScene()
    rerender({ collapsed: true })
    const folding = [...animations]
    await act(async () => {
      shell.dispatchEvent(new PointerEvent('pointermove', { buttons: 1 }))
    })
    expect(folding.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true)
    expect(shell.dataset.coveCollapseMotion).toBeUndefined()
    rerender({ collapsed: false })
    const unfolding = animations.slice(folding.length)
    unmount()
    await act(async () => {
      await Promise.resolve()
    })
    expect(unfolding.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true)
    expect(shell.dataset.coveCollapseMotion).toBeUndefined()
  })

  it('cancels a current morph and skips future motion when reduced motion is enabled', async () => {
    const { shell, rerender } = windowScene()
    rerender({ collapsed: true })
    const count = animations.length
    await act(async () => {
      reducedMotion = true
      media.dispatchEvent(new Event('change'))
    })
    expect(animations.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true)
    expect(shell.dataset.coveCollapseMotion).toBeUndefined()
    rerender({ collapsed: false })
    expect(animations).toHaveLength(count)
  })

  it('cancels layout effects when the workspace switches and never mutates target geometry', async () => {
    const canvas = document.createElement('div')
    const frame = document.createElement('div')
    frame.dataset.testid = 'workspace-space-region-space'
    frame.style.cssText = 'width:900px;height:600px;transform:translate(20px,30px)'
    canvas.append(frame)
    document.body.append(canvas)
    const ref = { current: canvas }
    const space = createSpace({
      id: 'space',
      nodeIds: [],
      rect: { x: 20, y: 30, width: 224, height: 160 },
    })
    const { result, rerender, unmount } = renderHook(
      ({ workspaceId }) => useCollapseLayoutMotion(workspaceId, ref),
      { initialProps: { workspaceId: 'one' } },
    )
    act(() => result.current.prepare('arrange', [], [space]))
    expect(animations).toHaveLength(1)
    rerender({ workspaceId: 'two' })
    await act(async () => {
      await Promise.resolve()
    })
    expect(animations[0].cancel).toHaveBeenCalledTimes(1)
    expect(space.rect).toEqual({ x: 20, y: 30, width: 224, height: 160 })
    expect(frame.style.width).toBe('900px')
    act(() => result.current.prepare('restore', [], [space]))
    unmount()
    await act(async () => {
      await Promise.resolve()
    })
    expect(animations[1].cancel).toHaveBeenCalledTimes(1)
  })
})
