import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import {
  applyRuntimeObservation,
  bindWorkspaceDocumentStore,
  commitCanvasDocument,
  registerWorkspaceDocumentPersistFlush,
} from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import type { WorkspaceState } from '../../../src/contexts/workspace/presentation/renderer/types'
import { pixelNode } from './workspacePixelLayer.fixtures'

function workspace(id: string): WorkspaceState {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    worktreesRoot: `/tmp/${id}`,
    nodes: [pixelNode({ title: id })],
    spaces: [],
    activeSpaceId: null,
    spaceArchiveRecords: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    isMinimapVisible: true,
  } as unknown as WorkspaceState
}

function retitled(workspaces: readonly WorkspaceState[]): WorkspaceState[] {
  return workspaces.map(item => ({
    ...item,
    nodes: item.nodes.map(node => ({ ...node, data: { ...node.data, title: 'observed' } })),
  }))
}

describe('applyRuntimeObservation', () => {
  let flush: ReturnType<typeof vi.fn>
  let unregister: () => void

  beforeEach(() => {
    useAppStore.setState({
      workspaces: [workspace('a'), workspace('b')],
      activeWorkspaceId: 'a',
    })
    flush = vi.fn()
    unregister = registerWorkspaceDocumentPersistFlush(flush)
  })

  afterEach(() => {
    unregister()
    bindWorkspaceDocumentStore(useAppStore)
    useAppStore.setState(useAppStore.getInitialState(), true)
  })

  it('does not write or flush when nothing changed', () => {
    const listener = vi.fn()
    const unsubscribe = useAppStore.subscribe(listener)
    const before = useAppStore.getState().workspaces

    const written = applyRuntimeObservation(workspaces => ({
      nextWorkspaces: [...workspaces],
      didChange: false,
      durableDidChange: true,
    }))
    unsubscribe()

    expect(written).toBe(false)
    expect(useAppStore.getState().workspaces).toBe(before)
    expect(listener).not.toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
  })

  it('writes every matched workspace in one notification and flushes only a durable change', () => {
    const listener = vi.fn()
    const unsubscribe = useAppStore.subscribe(listener)

    expect(
      applyRuntimeObservation(workspaces => ({
        nextWorkspaces: retitled(workspaces),
        didChange: true,
        durableDidChange: false,
      })),
    ).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().workspaces.map(item => item.nodes[0].data.title)).toEqual([
      'observed',
      'observed',
    ])
    expect(flush).not.toHaveBeenCalled()

    applyRuntimeObservation(workspaces => ({
      nextWorkspaces: retitled(workspaces).map(item => ({
        ...item,
        nodes: item.nodes.map(node => ({ ...node, data: { ...node.data, title: 'durable' } })),
      })),
      didChange: true,
      durableDidChange: true,
    }))
    unsubscribe()

    expect(listener).toHaveBeenCalledTimes(2)
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('reads the store when it runs, not when the observation was scheduled', () => {
    commitCanvasDocument('a', document => ({ ...document, isMinimapVisible: false }))

    applyRuntimeObservation(workspaces => {
      expect(workspaces[0].isMinimapVisible).toBe(false)
      return { nextWorkspaces: retitled(workspaces), didChange: true, durableDidChange: false }
    })

    expect(useAppStore.getState().workspaces[0].isMinimapVisible).toBe(false)
  })

  it('throws in development when an observation changes a field other than nodes', () => {
    const before = useAppStore.getState().workspaces

    expect(() =>
      applyRuntimeObservation(workspaces => ({
        nextWorkspaces: workspaces.map(item => ({ ...item, name: 'renamed' })),
        didChange: true,
        durableDidChange: false,
      })),
    ).toThrow('only nodes may change')
    expect(useAppStore.getState().workspaces).toBe(before)
  })

  it('throws when it runs inside a recipe', () => {
    expect(() =>
      commitCanvasDocument('a', document => {
        applyRuntimeObservation(workspaces => ({
          nextWorkspaces: [...workspaces],
          didChange: false,
          durableDidChange: false,
        }))
        return document
      }),
    ).toThrow('workspace document command ran inside a recipe')
  })
})
