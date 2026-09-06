import { describe, expect, it, vi } from 'vitest'
import { createCreatedNodePublisher } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCreatedNodePublisher'
import {
  subscribeWorkspaceNodeCreated,
  subscribeWorkspaceNodeCreationPrepared,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeCreationEvents'
import { pixelNode } from './workspacePixelLayer.fixtures'
import type { UseWorkspaceCanvasNodesStoreResult } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore.types'

describe('workspace creation notifications', () => {
  it('prepares all new node kinds including native websites before commit, using one creation timestamp', () => {
    const prepared = vi.fn()
    const unsubscribe = subscribeWorkspaceNodeCreationPrepared(prepared)
    try {
      const kinds = [
        'agent',
        'terminal',
        'note',
        'task',
        'document',
        'image',
        'website',
        'role',
      ] as const
      const created = kinds.map(kind => ({ ...pixelNode({ kind }), id: kind }))
      const publisher = createCreatedNodePublisher(update => {
        const next = update([])
        expect(prepared).toHaveBeenCalledExactlyOnceWith(kinds, expect.any(Number))
        expect(next).toEqual(created)
      })
      publisher(() => created)
    } finally {
      unsubscribe()
    }
  })
  it('notifies only after a creation transaction commits, independently of viewport focus', () => {
    const events: string[] = []
    let nodes = [pixelNode()]
    const setNodes: UseWorkspaceCanvasNodesStoreResult['setNodes'] = update => {
      nodes = update(nodes)
    }
    const unsubscribe = subscribeWorkspaceNodeCreated(id => {
      expect(nodes.some(node => node.id === id)).toBe(true)
      events.push(id)
    })
    const publishCreation = createCreatedNodePublisher(setNodes)
    setNodes(previous => [...previous, { ...pixelNode(), id: 'restored' }])
    expect(events).toEqual([])
    publishCreation(previous => [...previous, { ...pixelNode({ kind: 'note' }), id: 'new' }])
    expect(events).toEqual(['new'])
    publishCreation(previous => previous.map(node => ({ ...node, selected: true })))
    publishCreation(previous => previous.filter(node => node.id !== 'new'))
    expect(events).toEqual(['new'])
    unsubscribe()
    const late = vi.fn()
    const unsubscribeLate = subscribeWorkspaceNodeCreated(late)
    expect(late).not.toHaveBeenCalled()
    unsubscribeLate()
  })
})
