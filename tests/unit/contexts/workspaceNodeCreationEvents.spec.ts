import { describe, expect, it, vi } from 'vitest'
import { createCreatedNodePublisher } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCreatedNodePublisher'
import { subscribeWorkspaceNodeCreated } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeCreationEvents'
import { pixelNode } from './workspacePixelLayer.fixtures'
import type { UseWorkspaceCanvasNodesStoreResult } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore.types'

describe('workspace creation notifications', () => {
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
