import {
  createWindowGlints,
  resolveWindowGlint,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/windowSignals/windowGlints'
import type { Ripple } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/ripples'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMPLETION_COOLDOWN_MS,
  createWindowSignalDetector,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/windowSignals/signalDetector'
import {
  clearWindowSignals,
  showWindowSignal,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/windowSignals/frameSignals'

const agent = (id: string, status: string | null) => ({ id, isAgent: true, status })

describe('window signal detector', () => {
  it('signals a finished run on working → standby, never on first sight', () => {
    const detector = createWindowSignalDetector()
    expect(detector.observe([agent('a', 'standby')], 0)).toEqual([])
    expect(detector.observe([agent('a', 'running')], 100)).toEqual([])
    expect(detector.observe([agent('a', 'standby')], 200)).toEqual([{ id: 'a', kind: 'complete' }])
    expect(detector.observe([agent('a', 'standby')], 300)).toEqual([])
  })

  it('cools a window down for three seconds between completion signals', () => {
    const detector = createWindowSignalDetector()
    detector.observe([agent('a', 'running')], 0)
    expect(detector.observe([agent('a', 'standby')], 1000)).toHaveLength(1)
    detector.observe([agent('a', 'running')], 1200)
    expect(detector.observe([agent('a', 'standby')], 1000 + COMPLETION_COOLDOWN_MS - 1)).toEqual([])
    detector.observe([agent('a', 'running')], 5000)
    expect(detector.observe([agent('a', 'standby')], 5000 + COMPLETION_COOLDOWN_MS)).toHaveLength(1)
  })

  it('signals a failure on every change into failed', () => {
    const detector = createWindowSignalDetector()
    detector.observe([agent('a', 'running')], 0)
    expect(detector.observe([agent('a', 'failed')], 10)).toEqual([{ id: 'a', kind: 'fail' }])
    expect(detector.observe([agent('a', 'failed')], 20)).toEqual([])
    detector.observe([agent('a', 'running')], 30)
    expect(detector.observe([agent('a', 'failed')], 40)).toEqual([{ id: 'a', kind: 'fail' }])
  })

  it('ignores windows that are not agents and forgets windows that are gone', () => {
    const detector = createWindowSignalDetector()
    detector.observe([{ id: 'note', isAgent: false, status: null }, agent('a', 'running')], 0)
    detector.observe([], 10)
    // Back after removal counts as first sight again.
    expect(detector.observe([agent('a', 'standby')], 20)).toEqual([])
  })
})

describe('window frame signals', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('marks a window frame for the signal and clears it afterwards', () => {
    const scope = document.createElement('div')
    scope.innerHTML = '<div class="react-flow__node" data-id="a"></div>'
    document.body.append(scope)
    const node = scope.querySelector<HTMLElement>('[data-id="a"]')!
    showWindowSignal(scope, 'a', 'complete', [10, 20, 30], 900)
    expect(node.dataset.coveSignal).toBe('complete')
    expect(node.style.getPropertyValue('--cove-signal-color')).toBe('rgb(10 20 30)')
    vi.advanceTimersByTime(899)
    expect(node.dataset.coveSignal).toBe('complete')
    vi.advanceTimersByTime(1)
    expect(node.dataset.coveSignal).toBeUndefined()
    expect(node.style.getPropertyValue('--cove-signal-color')).toBe('')
  })

  it('lets a stronger signal replace completion and clears everything on demand', () => {
    const scope = document.createElement('div')
    scope.innerHTML = '<div class="react-flow__node" data-id="a"></div>'
    const node = scope.querySelector<HTMLElement>('[data-id="a"]')!
    showWindowSignal(scope, 'a', 'complete', [1, 2, 3], 500)
    showWindowSignal(scope, 'a', 'fail', [200, 0, 0], 600)
    expect(node.dataset.coveSignal).toBe('fail')
    // A later completion never hides a failure.
    showWindowSignal(scope, 'a', 'complete', [1, 2, 3], 500)
    expect(node.dataset.coveSignal).toBe('fail')
    clearWindowSignals(scope)
    expect(node.dataset.coveSignal).toBeUndefined()
    vi.advanceTimersByTime(1000)
    expect(node.dataset.coveSignal).toBeUndefined()
  })
})

describe('continuous completion rim', () => {
  const frame = { id: 'target', rect: { x: 300, y: -50, width: 100, height: 100 } }
  const wave: Ripple = {
    sourceId: 'sender',
    x: 0,
    y: 0,
    radius: 350,
    band: 56,
    strength: 0.6,
    color: [20, 40, 60],
    glint: '#abcdef',
    sweep: true,
  }

  it('matches the receiving Gaussian continuously, with the short side added to its width', () => {
    for (const radius of [0, 100, 200, 300, 350, 400, 500, 650, 700]) {
      const x = (350 - radius) / (56 + 50)
      const expected = Math.abs(x) > 2.6 ? 0 : 0.6 * Math.exp(-x * x)
      expect(resolveWindowGlint(frame, [{ ...wave, radius }]).intensity).toBeCloseTo(
        expected < 0.02 ? 0 : expected,
        12,
      )
    }
    expect(resolveWindowGlint(frame, [wave]).color).toBe('#abcdef')
  })

  it('takes the strongest sweep, excludes the sender and carries its ink through the white crest', () => {
    const crest: Ripple = {
      ...wave,
      crest: true,
      color: [255, 255, 255],
      strength: 0.8,
      glint: '#112233',
    }
    expect(resolveWindowGlint(frame, [wave, crest])).toEqual({ intensity: 0.8, color: '#112233' })
    expect(resolveWindowGlint({ ...frame, id: 'sender' }, [wave, crest]).intensity).toBe(0)
    expect(resolveWindowGlint(frame, [{ ...wave, sweep: false }]).intensity).toBe(0)
  })

  it('writes only meaningful amplitude changes and always removes a finished or disabled rim', () => {
    const scope = document.createElement('div')
    scope.innerHTML =
      '<div class="react-flow__node" data-id="target" style="background: var(--cove-surface)"></div>'
    document.body.append(scope)
    const node = scope.firstElementChild as HTMLElement
    const background = node.style.background
    const glints = createWindowGlints(() => scope)
    const writes = vi.spyOn(node.style, 'setProperty')
    glints.update([frame], [wave])
    expect(node.querySelector('.cove-window-glint')).not.toBeNull()
    expect(node.style.getPropertyValue('--cove-catch')).toBe('0.600')
    glints.update([frame], [{ ...wave, strength: 0.61 }])
    expect(writes.mock.calls.filter(call => call[0] === '--cove-catch')).toHaveLength(1)
    glints.update([frame], [{ ...wave, strength: 0.64 }])
    expect(node.style.getPropertyValue('--cove-catch')).toBe('0.640')
    expect(node.style.background).toBe(background)
    glints.update([frame], [])
    expect(node.style.getPropertyValue('--cove-catch')).toBe('0')
    expect(node.querySelector('.cove-window-glint')).toBeNull()
    glints.update([frame], [wave])
    glints.clear()
    expect(node.style.getPropertyValue('--cove-catch')).toBe('0')
    expect(node.dataset.coveSwept).toBeUndefined()
    expect(node.style.getPropertyValue('--cove-glint')).toBe('')
    scope.remove()
  })

  it('cleans a removed window without retaining its element', () => {
    const scope = document.createElement('div')
    scope.innerHTML = '<div class="react-flow__node" data-id="target"></div>'
    const node = scope.firstElementChild as HTMLElement
    const glints = createWindowGlints(() => scope)
    glints.update([frame], [wave])
    node.remove()
    glints.update([], [wave])
    expect(node.querySelector('.cove-window-glint')).toBeNull()
    expect(node.style.getPropertyValue('--cove-catch')).toBe('0')
  })
})
