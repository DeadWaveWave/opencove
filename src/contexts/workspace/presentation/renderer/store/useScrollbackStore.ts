import { create } from 'zustand'
import { normalizeScrollback } from '../utils/persistence/normalize'

export interface ScrollbackStoreState {
  scrollbackByNodeId: Record<string, string>

  setNodeScrollback: (nodeId: string, scrollback: string | null) => void
  clearNodeScrollback: (nodeId: string) => void
  hydrateScrollbacks: (scrollbacks: Record<string, string>) => void
  clearAllScrollbacks: () => void
}

export const useScrollbackStore = create<ScrollbackStoreState>(set => ({
  scrollbackByNodeId: {},

  setNodeScrollback: (nodeId, scrollback) => {
    const normalizedId = nodeId.trim()
    if (normalizedId.length === 0) {
      return
    }

    const normalized = normalizeScrollback(scrollback)
    if (!normalized) {
      set(state => {
        if (!(normalizedId in state.scrollbackByNodeId)) {
          return state
        }

        const record = state.scrollbackByNodeId
        delete record[normalizedId]
        return { scrollbackByNodeId: record }
      })
      return
    }

    set(state => {
      if (state.scrollbackByNodeId[normalizedId] === normalized) {
        return state
      }

      state.scrollbackByNodeId[normalizedId] = normalized
      return {
        scrollbackByNodeId: state.scrollbackByNodeId,
      }
    })
  },

  clearNodeScrollback: nodeId => {
    const normalized = nodeId.trim()
    if (normalized.length === 0) {
      return
    }

    set(state => {
      if (!(normalized in state.scrollbackByNodeId)) {
        return state
      }

      const record = state.scrollbackByNodeId
      delete record[normalized]
      return { scrollbackByNodeId: record }
    })
  },

  hydrateScrollbacks: scrollbacks => {
    set(() => ({ scrollbackByNodeId: { ...scrollbacks } }))
  },

  clearAllScrollbacks: () => {
    set(() => ({ scrollbackByNodeId: {} }))
  },
}))
