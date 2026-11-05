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
  const { size, proposed, canonical } = after
  return Boolean(
    before.sessionId &&
    after.sessionId === before.sessionId &&
    after.hydrated &&
    size &&
    proposed &&
    canonical &&
    (canonical.revision ?? 0) > (before.canonical?.revision ?? 0) &&
    (proposed.cols !== before.proposed?.cols || proposed.rows !== before.proposed?.rows) &&
    size.cols === proposed.cols &&
    size.rows === proposed.rows &&
    size.cols === canonical.cols &&
    size.rows === canonical.rows,
  )
}
