import type { PersistedAppState } from '@contexts/workspace/presentation/renderer/types'
import { readPersistedStateWithMeta } from '@contexts/workspace/presentation/renderer/utils/persistence/read'
import { MockStorage } from '../persistenceTestStorage'

export function localViewImage(state: PersistedAppState) {
  return {
    activeWorkspaceId: state.activeWorkspaceId,
    workspaces: Object.fromEntries(
      state.workspaces.map(w => [
        w.id,
        {
          viewport: w.viewport,
          isMinimapVisible: w.isMinimapVisible,
          activeSpaceId: w.activeSpaceId,
        },
      ]),
    ),
  }
}

/** Intent oracle: values come only from fixture inputs and local actions, never from storage/SUT. */
export class LocalViewModel {
  private generation = 0
  expected: ReturnType<typeof localViewImage>
  constructor(initial: PersistedAppState) {
    this.expected = structuredClone(localViewImage(initial))
  }
  edit() {
    const generation = ++this.generation
    this.expected = {
      activeWorkspaceId: generation % 2 ? 'view-project' : 'project',
      workspaces: {
        project: {
          viewport: { x: 123 + generation, y: -456 - generation, zoom: 1 + generation / 10 },
          activeSpaceId: generation % 2 ? 'second' : 'space',
          isMinimapVisible: generation % 2 === 0,
        },
        'view-project': {
          viewport: { x: -250 - generation, y: 320 + generation, zoom: 0.7 + generation / 10 },
          activeSpaceId: null,
          isMinimapVisible: generation % 2 === 0,
        },
      },
    }
    return structuredClone(this.expected)
  }
  check(state: PersistedAppState) {
    if (!isDeepStrictEqual(localViewImage(state), this.expected)) {
      throw new Error(
        `I12: local view intent was replaced; expected=${JSON.stringify(this.expected)} actual=${JSON.stringify(localViewImage(state))}`,
      )
    }
  }
  async checkColdRestore() {
    // Reconstruct durable storage in a fresh instance; read has no access to live UI or this oracle.
    // Keep unrelated unconfirmed shared drafts intact while testing this independent restore path.
    const original = window.localStorage
    const cold = new MockStorage()
    for (let i = 0; i < original.length; i++) {
      const key = original.key(i)!
      cold.setItem(key, original.getItem(key)!)
    }
    Object.defineProperty(window, 'localStorage', { configurable: true, value: cold })
    try {
      const restored = (await readPersistedStateWithMeta()).state
      if (!restored) {
        throw new Error('I12: cold restore has no view state')
      }
      this.check(restored)
    } finally {
      Object.defineProperty(window, 'localStorage', { configurable: true, value: original })
    }
  }
}

export function withLocalViews(state: PersistedAppState): PersistedAppState {
  const project = state.workspaces[0]
  return {
    ...state,
    activeWorkspaceId: 'view-project',
    workspaces: [
      {
        ...project,
        viewport: { x: -312, y: 218, zoom: 0.8 },
        activeSpaceId: 'second',
        isMinimapVisible: false,
      },
      {
        ...project,
        id: 'view-project',
        name: 'Local view project',
        nodes: [],
        spaces: [],
        activeSpaceId: null,
        viewport: { x: -225, y: 310, zoom: 1.1 },
        isMinimapVisible: false,
      },
    ],
  }
}
import { isDeepStrictEqual } from 'node:util'
