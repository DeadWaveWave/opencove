import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Page } from '@playwright/test'
import { expectAnimatedWall } from '../../e2e/workspace-canvas.pixel-wall.helpers'

vi.mock('@playwright/test', async () => ({ expect: (await import('vitest')).expect }))

const page = {
  evaluate: async (callback: () => unknown) => callback(),
} as unknown as Page

const timers: ReturnType<typeof setInterval>[] = []

afterEach(() => {
  timers.forEach(clearInterval)
  timers.length = 0
  delete window.__opencovePixelWallTestApi
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function probe(animated = 20, total = 42) {
  window.__opencovePixelWallTestApi = {
    getFrameCount: () => total,
    getAnimatedFrameCount: () => animated,
  } as NonNullable<Window['__opencovePixelWallTestApi']>
  return { advance: () => animated++ }
}

describe('pixel wall animation assertion', () => {
  it('waits for three new frames when fewer arrive in the first 500ms', async () => {
    const h = probe()
    const attach = vi.fn()
    // Three frames take 750ms; the 20 historical frames must not satisfy the assertion.
    let delivered = 0
    const timer = setInterval(() => {
      h.advance()
      if (++delivered === 3) {
        clearInterval(timer)
      }
    }, 250)
    timers.push(timer)
    await expectAnimatedWall(page, { attach })
    expect(window.__opencovePixelWallTestApi!.getAnimatedFrameCount()).toBe(23)
    expect(attach).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'reports a stalled wall with page rAF delivery = %s, then cancels observation',
    async deliversRaf => {
      probe(17)
      const host = document.createElement('div')
      host.dataset.testid = 'workspace-pixel-wall'
      host.dataset.coveWallRenderer = '2d'
      host.dataset.coveWallState = 'ready'
      document.body.append(host)
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(
        deliversRaf ? 'visible' : 'hidden',
      )
      vi.spyOn(document, 'hasFocus').mockReturnValue(false)
      const callbacks = new Map<number, FrameRequestCallback>()
      let id = 0
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
        callbacks.set(++id, callback)
        return id
      })
      vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(frame => {
        callbacks.delete(frame)
      })
      if (deliversRaf) {
        timers.push(
          setInterval(() => {
            const pending = [...callbacks.values()]
            callbacks.clear()
            pending.forEach(callback => callback(performance.now()))
          }, 16),
        )
      }
      const attach = vi.fn()
      const failure = await expectAnimatedWall(page, { attach }).catch(error => error)
      expect(failure).toBeInstanceOf(Error)
      expect(failure.message).toContain('at least 3 new animated frames')
      expect(attach).toHaveBeenCalledOnce()
      const [name, attachment] = attach.mock.calls[0]!
      expect(name).toBe('pixel-wall-animation-diagnostics')
      expect(attachment.contentType).toBe('application/json')
      const diagnostics = JSON.parse(attachment.body.toString())
      expect(diagnostics).toMatchObject({
        baseline: 17,
        visibilityState: deliversRaf ? 'visible' : 'hidden',
        hasFocus: false,
        totalFrames: 42,
        animatedFrames: 17,
        renderer: '2d',
        state: 'ready',
        rafSampleMs: 500,
      })
      if (deliversRaf) {
        expect(diagnostics.rafCallbacks).toBeGreaterThan(0)
      } else {
        expect(diagnostics.rafCallbacks).toBe(0)
      }
      expect(callbacks.size).toBe(0)
    },
  )
})
