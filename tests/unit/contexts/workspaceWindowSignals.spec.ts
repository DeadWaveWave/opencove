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

  it('lets a stronger signal replace a sweep and clears everything on demand', () => {
    const scope = document.createElement('div')
    scope.innerHTML = '<div class="react-flow__node" data-id="a"></div>'
    const node = scope.querySelector<HTMLElement>('[data-id="a"]')!
    showWindowSignal(scope, 'a', 'swept', [1, 2, 3], 500)
    showWindowSignal(scope, 'a', 'fail', [200, 0, 0], 600)
    expect(node.dataset.coveSignal).toBe('fail')
    // A later sweep never hides a failure.
    showWindowSignal(scope, 'a', 'swept', [1, 2, 3], 500)
    expect(node.dataset.coveSignal).toBe('fail')
    clearWindowSignals(scope)
    expect(node.dataset.coveSignal).toBeUndefined()
    vi.advanceTimersByTime(1000)
    expect(node.dataset.coveSignal).toBeUndefined()
  })
})
