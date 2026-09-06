import { describe, expect, it, vi } from 'vitest'
import {
  publishWorkspaceNodesClosed,
  subscribeWorkspaceNodesClosed,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeClosureEvents'

describe('successful node-closure notifications', () => {
  it('publishes only nonempty unique IDs, with no history or replay after unsubscription', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeWorkspaceNodesClosed(listener)
    try {
      publishWorkspaceNodesClosed([])
      publishWorkspaceNodesClosed(['', ' '])
      expect(listener).not.toHaveBeenCalled()
      publishWorkspaceNodesClosed(['one', 'two', 'one'])
      expect(listener).toHaveBeenCalledExactlyOnceWith(['one', 'two'])
    } finally {
      unsubscribe()
    }
    publishWorkspaceNodesClosed(['three'])
    expect(listener).toHaveBeenCalledTimes(1)
    const lateListener = vi.fn()
    const unsubscribeLate = subscribeWorkspaceNodesClosed(lateListener)
    expect(lateListener).not.toHaveBeenCalled()
    unsubscribeLate()
  })
})
