import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPixelNodeMasks } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/nodeMasks'
import { createCreatedNodePublisher } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCreatedNodePublisher'
import {
  subscribeWorkspaceNodeCreationPrepared,
  subscribeWorkspaceNodeCreationCancelled,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeCreationEvents'
import { pixelNode } from './workspacePixelLayer.fixtures'

describe('creation-scoped first-paint alpha masks', () => {
  let scope: HTMLDivElement
  let now: number
  let masks: ReturnType<typeof createPixelNodeMasks>
  const css = () =>
    document.adoptedStyleSheets
      .flatMap(sheet => [...sheet.cssRules])
      .map(rule => rule.cssText)
      .join('\n')

  beforeEach(() => {
    vi.useFakeTimers()
    now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    scope = document.createElement('div')
    scope.className = 'react-flow'
    document.body.append(scope)
    masks = createPixelNodeMasks(scope)
  })
  afterEach(() => {
    masks.dispose()
    scope.remove()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('registers an all-transparent mask before the successful owner can mount the actual node', () => {
    let nodes: ReturnType<typeof pixelNode>[] = []
    const unsubscribe = subscribeWorkspaceNodeCreationPrepared((ids, createdAt) =>
      masks.prepare(ids, createdAt),
    )
    const publish = createCreatedNodePublisher(update => {
      const next = update(nodes)
      expect(css()).toContain('data-id="new-node"')
      expect(css()).toContain('linear-gradient(transparent, transparent)')
      const node = document.createElement('div')
      node.className = 'react-flow__node'
      node.dataset.id = 'new-node'
      node.style.width = '700px'
      node.style.height = '240px'
      scope.append(node)
      nodes = next
    })
    try {
      publish(previous => [...previous, { ...pixelNode(), id: 'new-node' }])
      expect(scope.querySelector<HTMLElement>('[data-id="new-node"]')?.style.cssText).toBe(
        'width: 700px; height: 240px;',
      )
    } finally {
      unsubscribe()
    }
  })

  it('keeps delayed renderers transparent, then grants both widths the same complete 380ms reveal', () => {
    expect(masks.prepare(['narrow', 'wide'], 0)).toEqual(['narrow', 'wide'])
    masks.update([], ['narrow', 'wide'])
    expect(css()).toContain('linear-gradient(transparent, transparent)')
    now = 240
    vi.advanceTimersByTime(240)
    expect(css()).toContain('linear-gradient(transparent, transparent)')
    expect(masks.markReady('narrow', now)).toBe(true)
    expect(masks.markReady('wide', now)).toBe(true)
    now = 430
    vi.advanceTimersByTime(190)
    expect(masks.markReady('wide', now)).toBe(false)
    masks.update(
      [160, 1600].map((width, index) => ({
        id: index ? 'wide' : 'narrow',
        sessionId: '',
        rect: { x: 0, y: 0, width, height: 300 },
        age: 190,
      })),
      ['narrow', 'wide'],
    )
    expect(css()).toContain('mask-image:')
    expect(css()).not.toMatch(/clip-path|pointer-events|width:|height:|display:|opacity:/)
    expect(vi.getTimerCount()).toBe(1)
    now = 619
    vi.advanceTimersByTime(189)
    expect(css()).toContain('data-id="narrow"')
    now = 620
    vi.advanceTimersByTime(1)
    expect(css()).not.toContain('data-id=')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('removes an unready mask at 1200ms and never resurrects it on late readiness', () => {
    masks.prepare(['unready'], 0)
    now = 1199
    vi.advanceTimersByTime(1199)
    expect(css()).toContain('data-id="unready"')
    now = 1200
    vi.advanceTimersByTime(1)
    expect(css()).not.toContain('data-id=')
    expect(masks.markReady('unready', 1300)).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rolls back a prepare when the owner rejects commit, and clears overflow/interaction/disposal without replay', () => {
    const unsubscribe = subscribeWorkspaceNodeCreationPrepared((ids, createdAt) =>
      masks.prepare(ids, createdAt),
    )
    const unsubscribeCancel = subscribeWorkspaceNodeCreationCancelled(ids =>
      ids.forEach(id => masks.reveal(id)),
    )
    try {
      const publish = createCreatedNodePublisher(update => {
        update([])
        throw new Error('commit failed')
      })
      expect(() => publish(() => [{ ...pixelNode(), id: 'failed' }])).toThrow('commit failed')
      expect(css()).not.toContain('failed')
      masks.prepare(['a', 'b'], 0)
      masks.update([], ['b'])
      expect(css()).not.toContain('data-id="a"')
      expect(masks.reveal('b')).toBe(true)
      expect(css()).not.toContain('data-id=')
      masks.prepare(['c'], 0)
      masks.clear()
      masks.update(
        [{ id: 'c', sessionId: '', rect: { x: 0, y: 0, width: 400, height: 300 }, age: 40 }],
        ['c'],
      )
      expect(css()).not.toContain('data-id=')
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      unsubscribe()
      unsubscribeCancel()
    }
  })

  it('fails open if stylesheet registration is unsupported or later fails', () => {
    vi.spyOn(CSSStyleSheet.prototype, 'replaceSync').mockImplementation(() => {
      throw new Error('unsupported')
    })
    expect(() => masks.prepare(['safe'], 0)).not.toThrow()
    expect(css()).not.toContain('safe')
    const unsupported = createPixelNodeMasks(scope)
    expect(unsupported.prepare(['plain'], 0)).toEqual([])
    unsupported.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
})
