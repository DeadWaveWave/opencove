import type { Page } from '@playwright/test'

export interface ContinuityCandidate {
  resumeSessionId: string | null
  verified: boolean | null
  position: { x: number; y: number } | null
}
export interface ContinuityWrite {
  seq: number
  route: string
  candidate: ContinuityCandidate | null
  readonly carried: 'A' | 'B' | 'other'
  baseRevision: number | null
  ok: boolean | null
  corrected: boolean | null
  merged: boolean | null
  revision: number | null
  error?: string
}
export interface ContinuityRead {
  seq: number
  route: string
  source: 'pending' | 'canonical' | 'frozen' | 'late-frozen' | 'error'
  canonicalRevision: number | null
  returnedRevision: number | null
  candidate: ContinuityCandidate | null
  error?: string
}
export interface ContinuityDiagnostics {
  nodeId: string
  a: string | null
  b: string | null
  seq: number
  reads: ContinuityRead[]
  writes: ContinuityWrite[]
}
declare global {
  interface Window {
    __managedContinuity?: ContinuityDiagnostics
  }
}
export async function readContinuityDiagnostics(page: Page) {
  return page.evaluate(() => {
    const log = window.__managedContinuity
    const node = log
      ? document.querySelector<HTMLElement>(`.react-flow__node[data-id="${log.nodeId}"]`)
      : null
    return {
      ...log,
      held: Boolean((window as unknown as { __heldManagedPrepare?: unknown }).__heldManagedPrepare),
      writes: log?.writes,
      node: {
        present: !!node,
        transform: node?.style.transform,
        dragging: node?.classList.contains('dragging'),
        editor: !!node?.querySelector('input'),
      },
    }
  })
}
export async function freezeManagedClient(page: Page) {
  await page.evaluate(() => {
    if (!window.__managedContinuity) {
      throw new Error('Continuity observer is not installed.')
    }
    Object.assign(window, { __dropManagedSync: true, __correctedManagedWrite: false })
  })
}
type Snapshot = Awaited<ReturnType<typeof readContinuityDiagnostics>>
async function waitForEvidence(
  page: Page,
  accepts: (log: Snapshot) => boolean,
  timeout: number,
  message: string,
) {
  let active = true
  let last: Snapshot | { observer: string } = { observer: 'No diagnostic snapshot received.' }
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${message}\n${JSON.stringify(last)}`)), timeout)
  })
  const observe = async (): Promise<void> => {
    if (!active) {
      return
    }
    const snapshot = await readContinuityDiagnostics(page)
    if (!active) {
      return
    }
    last = snapshot
    if (accepts(snapshot)) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 50))
    return await observe()
  }
  try {
    await Promise.race([observe(), expired])
  } finally {
    active = false
    clearTimeout(timer)
  }
}
export async function waitForManagedPrepare(page: Page) {
  await waitForEvidence(
    page,
    log => log.held,
    10_000,
    'The target agent preparation did not reach the hold barrier.',
  )
}
export async function waitForManagedLayoutWrite(
  page: Page,
  options: {
    afterSeq: number
    before: { x: number; y: number }
    stale: boolean
    timeout?: number
  },
) {
  await waitForEvidence(
    page,
    log =>
      Boolean(
        log.writes?.some(
          write =>
            write.seq > options.afterSeq &&
            write.route === 'structured' &&
            write.carried === 'A' &&
            write.ok &&
            write.candidate?.position &&
            (write.candidate.position.x !== options.before.x ||
              write.candidate.position.y !== options.before.y) &&
            (!options.stale || write.corrected || write.merged),
        ),
      ),
    options.timeout ?? 15_000,
    options.stale
      ? 'The layout did not submit A with a corrected or merged receipt. Read/write evidence follows.'
      : 'The initial layout was not published. Read/write evidence follows.',
  )
}

export async function waitForManagedNodeMovement(page: Page, before: string) {
  await waitForEvidence(
    page,
    log => Boolean(log.node.transform && log.node.transform !== before),
    5_000,
    'The header drag did not change the node position. Read/write evidence follows.',
  )
}
