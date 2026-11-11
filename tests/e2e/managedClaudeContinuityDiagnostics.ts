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
  uncertain?: boolean | null
  revision: number | null
  error?: string
}
export type ConfirmedContinuityWrite = ContinuityWrite & {
  ok: true
  revision: number
  candidate: ContinuityCandidate & { position: { x: number; y: number } }
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
async function waitForEvidence<Snapshot, Result>(
  read: () => Promise<Snapshot>,
  select: (log: Snapshot) => Result | undefined,
  timeout: number,
  message: string,
) {
  let active = true
  let last: Snapshot | { observer: string } = { observer: 'No diagnostic snapshot received.' }
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${message}\n${JSON.stringify(last)}`)), timeout)
  })
  const observe = async (): Promise<Result | undefined> => {
    if (!active) {
      return
    }
    const snapshot = await read()
    if (!active) {
      return
    }
    last = snapshot
    const result = select(snapshot)
    if (result !== undefined) {
      return result
    }
    await new Promise(resolve => setTimeout(resolve, 50))
    return await observe()
  }
  try {
    const result = await Promise.race([observe(), expired])
    if (result === undefined) {
      throw new Error(message)
    }
    return result
  } finally {
    active = false
    clearTimeout(timer)
  }
}
export async function waitForManagedPrepare(page: Page) {
  await waitForEvidence(
    () => readContinuityDiagnostics(page),
    log => (log.held ? true : undefined),
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
  return await waitForEvidence(
    () => readContinuityDiagnostics(page),
    log =>
      log.writes?.find(
        (write): write is ConfirmedContinuityWrite =>
          write.seq > options.afterSeq &&
          write.route === 'structured' &&
          write.carried === 'A' &&
          write.ok === true &&
          write.uncertain !== true &&
          write.revision !== null &&
          Number.isSafeInteger(write.revision) &&
          write.revision >= 0 &&
          !!write.candidate?.position &&
          (write.candidate.position.x !== options.before.x ||
            write.candidate.position.y !== options.before.y) &&
          (!options.stale || write.corrected === true || write.merged === true),
      ),
    options.timeout ?? 15_000,
    options.stale
      ? 'The layout did not submit A with a corrected or merged receipt and a confirmed commit revision. Read/write evidence follows.'
      : 'The initial layout has no confirmed commit revision. Read/write evidence follows.',
  )
}

/** Verify durable layout and identity together before another writer can replace the position. */
export async function waitForManagedCanonicalLayout(
  page: Page,
  nodeId: string,
  write: ConfirmedContinuityWrite,
  tuple: { resumeSessionId: string; resumeSessionIdVerified: boolean },
  timeout = 15_000,
) {
  return await waitForEvidence(
    async () => {
      const canonical = await page.evaluate(async targetNodeId => {
        const snapshot = await window.opencoveApi.persistence.readAppState()
        const state = snapshot.state as {
          workspaces: Array<{
            nodes: Array<{
              id: string
              position: { x: number; y: number }
              agent?: { resumeSessionId?: string; resumeSessionIdVerified?: boolean }
            }>
          }>
        } | null
        const node = state?.workspaces.flatMap(w => w.nodes).find(n => n.id === targetNodeId)
        return {
          revision: snapshot.revision,
          tuple: {
            resumeSessionId: node?.agent?.resumeSessionId ?? null,
            resumeSessionIdVerified: node?.agent?.resumeSessionIdVerified ?? null,
          },
          position: node?.position ?? null,
        }
      }, nodeId)
      return {
        canonical,
        write,
        expectedTuple: tuple,
        diagnostics: await readContinuityDiagnostics(page),
      }
    },
    evidence => {
      const { canonical } = evidence
      return canonical.revision !== null &&
        Number.isSafeInteger(canonical.revision) &&
        canonical.revision >= write.revision &&
        canonical.tuple.resumeSessionId === tuple.resumeSessionId &&
        canonical.tuple.resumeSessionIdVerified === tuple.resumeSessionIdVerified &&
        canonical.position?.x === write.candidate.position.x &&
        canonical.position?.y === write.candidate.position.y
        ? canonical
        : undefined
    },
    timeout,
    'The canonical snapshot did not retain the submitted layout and expected conversation. Read/write evidence follows.',
  )
}

export async function waitForManagedNodeMovement(page: Page, before: string) {
  await waitForEvidence(
    () => readContinuityDiagnostics(page),
    log => (log.node.transform && log.node.transform !== before ? true : undefined),
    5_000,
    'The header drag did not change the node position. Read/write evidence follows.',
  )
}
