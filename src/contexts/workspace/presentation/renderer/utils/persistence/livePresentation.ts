import type { PersistedAppState } from '../../types'
import { content, persistenceScope } from './publicationState'

let live: { scope: number; produce: () => PersistedAppState } | null = null

/** The presentation owner supplies a live baseline without coupling persistence to its UI store. */
export function registerPublicationPresentation(produce: () => PersistedAppState): () => void {
  const registration = { scope: persistenceScope(), produce }
  live = registration
  return () => {
    if (live === registration) {
      live = null
    }
  }
}

/** Capture before submission: a replacement must preserve only later presentation edits. */
export function capturePublicationPresentation(): string | undefined {
  return live?.scope === persistenceScope() ? content(live.produce()) : undefined
}
