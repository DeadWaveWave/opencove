import { useMemo } from 'react'
import { publishWorkspaceNodeCreated } from '../nodeCreationEvents'
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'

type SetNodes = UseWorkspaceCanvasNodesStoreResult['setNodes']

/** Wrap only the creation entry points; hydration and ordinary mutations keep the original setter. */
export function createCreatedNodePublisher(setNodes: SetNodes): SetNodes {
  return (update, options) => {
    let addedIds: string[] = []
    // The workspace owner commits this updater synchronously before returning.
    setNodes(previous => {
      const next = update(previous)
      const previousIds = new Set(previous.map(node => node.id))
      addedIds = next.filter(node => !previousIds.has(node.id)).map(node => node.id)
      return next
    }, options)
    addedIds.forEach(publishWorkspaceNodeCreated)
  }
}

export function useCreatedNodePublisher(setNodes: SetNodes): SetNodes {
  return useMemo(() => createCreatedNodePublisher(setNodes), [setNodes])
}
