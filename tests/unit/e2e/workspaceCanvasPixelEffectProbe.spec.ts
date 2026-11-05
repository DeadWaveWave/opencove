import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Page } from '@playwright/test'
import {
  installPixelEffectProbe,
  readPixelEffectProbe,
  stopPixelEffectProbe,
} from '../../e2e/workspace-canvas.pixel-effects.helpers'

vi.mock('@playwright/test', () => ({ expect: vi.fn() }))

const page = { evaluate: async (callback: () => unknown) => callback() } as unknown as Page
// Flush observer microtasks without a timer turn: happy-dom 20.8.4 holds its dispatch
// callback weakly, so a real timeout lets GC drop it between the simulated draws.
const settleMutations = () => Promise.resolve()

beforeEach(() => {
  // Observer delivery must work without advancing wall time between painted frames.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(async () => {
  await stopPixelEffectProbe(page)
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function fixture() {
  const callbacks = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
  const tick = () => {
    const pending = [...callbacks.values()]
    callbacks.clear()
    pending.forEach(callback => callback(performance.now()))
  }
  const canvas = document.createElement('canvas')
  canvas.dataset.testid = 'workspace-pixel-assembly'
  canvas.width = 800
  canvas.height = 600
  canvas.dataset.covePixelAssembly = 'idle'
  canvas.dataset.covePixelNodeIds = ''
  canvas.dataset.covePixelBurst = 'idle'
  canvas.dataset.covePixelBurstNodeIds = ''
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: 0, y: 0, width: 800, height: 600 }),
  )
  let alpha = 0
  vi.spyOn(canvas, 'getContext').mockReturnValue({
    getImageData: () => ({ data: new Uint8ClampedArray([40, 120, 200, alpha]) }),
  } as unknown as CanvasRenderingContext2D)
  document.body.append(canvas)
  const addNode = () => {
    const node = document.createElement('div')
    node.className = 'react-flow__node'
    node.dataset.id = 'created-note'
    node.innerHTML = '<div class="note-node"><textarea></textarea></div>'
    vi.spyOn(node, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 100, y: 100, width: 320, height: 220 }),
    )
    node.style.setProperty('--cove-pixel-reveal-front', '0')
    node.style.maskImage = 'linear-gradient(transparent, transparent)'
    document.body.append(node)
    return node
  }
  const draw = (front: number, pixels = 100) => {
    const node = document.querySelector<HTMLElement>('[data-id="created-note"]')!
    node.style.setProperty('--cove-pixel-reveal-front', String(front))
    alpha = pixels
    canvas.dataset.covePixelAssembly = 'assembling'
    canvas.dataset.covePixelNodeIds = 'created-note'
  }
  return {
    canvas,
    tick,
    addNode,
    draw,
    callbacks,
    paintPixels: () => (alpha = 100),
    clearPixels: () => (alpha = 0),
  }
}

describe('pixel effect E2E recorder', () => {
  it('retains a drawn rim when deadline cleanup precedes the next observer RAF', async () => {
    const h = fixture()
    await installPixelEffectProbe(page)
    const node = h.addNode()
    h.tick() // The independent RAF observer runs before the product draw.
    h.draw(0.5)
    await settleMutations()
    node.style.removeProperty('--cove-pixel-reveal-front')
    node.style.maskImage = 'none'
    h.clearPixels()
    h.canvas.dataset.covePixelAssembly = 'idle'
    h.canvas.dataset.covePixelNodeIds = ''
    await settleMutations()
    h.tick()
    expect((await readPixelEffectProbe(page)).created['created-note']?.rim).toBe(true)
  })

  it('records visible pixels outside the middle of the reveal without accepting empty frames', async () => {
    const h = fixture()
    await installPixelEffectProbe(page)
    h.addNode()
    h.draw(0.95, 0)
    await settleMutations()
    h.tick()
    expect((await readPixelEffectProbe(page)).created['created-note']?.rim).toBe(false)
    h.draw(0.95)
    await settleMutations()
    h.tick()
    expect((await readPixelEffectProbe(page)).created['created-note']?.rim).toBe(true)
  })

  it('retains painted close scatter after expiry, only after the node has been removed', async () => {
    const h = fixture()
    await installPixelEffectProbe(page)
    const node = h.addNode()
    h.tick()
    h.canvas.dataset.covePixelBurst = 'bursting'
    h.canvas.dataset.covePixelBurstNodeIds = 'created-note'
    await settleMutations()
    expect((await readPixelEffectProbe(page)).bursts).toEqual([])
    node.remove()
    h.canvas.dataset.covePixelBurstNodeIds = 'created-note'
    await settleMutations()
    // A post-close attribute without pixels is not proof that scatter was drawn.
    expect((await readPixelEffectProbe(page)).bursts).toEqual([])
    h.paintPixels()
    h.canvas.dataset.covePixelBurstNodeIds = 'created-note'
    await settleMutations()
    h.clearPixels()
    h.canvas.dataset.covePixelBurst = 'idle'
    h.canvas.dataset.covePixelBurstNodeIds = ''
    await settleMutations()
    h.tick()
    expect((await readPixelEffectProbe(page)).bursts).toEqual(['created-note'])
  })

  it('disconnects observation at teardown', async () => {
    const h = fixture()
    await installPixelEffectProbe(page)
    h.addNode()
    h.draw(0, 0)
    h.tick()
    await settleMutations()
    await stopPixelEffectProbe(page)
    h.draw(0.5)
    await settleMutations()
    h.tick()
    expect((await readPixelEffectProbe(page)).created['created-note']?.rim).toBe(false)
    expect(h.callbacks.size).toBe(0)
  })

  it('discovers a reduced-motion node on an idle draw without inventing a rim', async () => {
    const h = fixture()
    await installPixelEffectProbe(page)
    const node = h.addNode()
    node.style.maskImage = 'none'
    h.canvas.dataset.covePixelAssembly = 'idle'
    await settleMutations()
    expect((await readPixelEffectProbe(page)).created['created-note']).toMatchObject({
      kind: 'note',
      rim: false,
    })
  })
})
