import type { Page } from '@playwright/test'

type Geometry = { cols: number; rows: number }

export type LiveTerminalFrame = {
  sessionId: string | null
  size: Geometry | null
  proposed: Geometry | null
  canonical: (Geometry & { revision: number | null }) | null
  hydrated: boolean
}

export async function readLiveTerminalFrame(
  page: Page,
  nodeId: string,
): Promise<LiveTerminalFrame> {
  return await page.evaluate(async id => {
    const api = window.__opencoveTerminalSelectionTestApi
    const sessionId = api?.getRuntimeSessionId(id) ?? null
    const snapshot = sessionId
      ? await window.opencoveApi.pty.presentationSnapshot({ sessionId })
      : null
    // Read the current renderer together, after the asynchronous Worker observation.
    return {
      sessionId: api?.getRuntimeSessionId(id) ?? null,
      size: api?.getSize(id) ?? null,
      proposed: api?.getProposedGeometry(id) ?? null,
      canonical: snapshot
        ? { cols: snapshot.cols, rows: snapshot.rows, revision: snapshot.geometryRevision }
        : null,
      hydrated:
        document
          .querySelector(`[data-id="${CSS.escape(id)}"] .terminal-node__terminal`)
          ?.getAttribute('aria-busy') === 'false',
    }
  }, nodeId)
}

export function isLiveReattachFrameCommitted(
  before: LiveTerminalFrame,
  after: LiveTerminalFrame,
): boolean {
  return Object.values(liveReattachFrameChecks(before, after)).every(Boolean)
}

export function liveReattachFrameChecks(before: LiveTerminalFrame, after: LiveTerminalFrame) {
  const { size, proposed, canonical } = after
  return {
    hadSession: Boolean(before.sessionId),
    sameSession: after.sessionId === before.sessionId,
    hydrated: after.hydrated,
    hasSize: Boolean(size),
    hasProposal: Boolean(proposed),
    hasCanonical: Boolean(canonical),
    newerRevision: (canonical?.revision ?? 0) > (before.canonical?.revision ?? 0),
    changedProposal:
      proposed?.cols !== before.proposed?.cols || proposed?.rows !== before.proposed?.rows,
    proposedColsMatch: size?.cols === proposed?.cols,
    proposedRowsMatch: size?.rows === proposed?.rows,
    canonicalColsMatch: size?.cols === canonical?.cols,
    canonicalRowsMatch: size?.rows === canonical?.rows,
  }
}
