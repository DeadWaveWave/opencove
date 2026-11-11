import type { Page } from '@playwright/test'
import type { ControlSurfaceInvokeRequest } from '../../src/shared/contracts/controlSurface'
import type { PreparedRuntimeNodeResult } from '../../src/shared/contracts/dto'
import type {
  ContinuityCandidate,
  ContinuityDiagnostics,
  ContinuityWrite,
  ContinuityRead,
} from './managedClaudeContinuityDiagnostics'

/** Hold one genuine live prepare response; observe both adapter receipts and canonical wire IO. */
export async function holdPrepare(page: Page, nodeId: string) {
  await page.addInitScript(targetNodeId => {
    let api: typeof window.opencoveApi
    let held = false
    const log: ContinuityDiagnostics = {
      nodeId: targetNodeId,
      a: null,
      b: null,
      seq: 0,
      reads: [],
      writes: [],
    }
    window.__managedContinuity = log
    const candidate = (state: unknown): ContinuityCandidate | null => {
      const value = state as {
        workspaces?: Array<{
          nodes?: Array<{
            id: string
            agent?: { resumeSessionId?: string; resumeSessionIdVerified?: boolean }
            position?: { x: number; y: number }
          }>
        }>
      } | null
      if (!Array.isArray(value?.workspaces)) {
        return null
      }
      const node = value.workspaces
        .flatMap(w => (Array.isArray(w?.nodes) ? w.nodes : []))
        .find(n => n?.id === targetNodeId)
      return node
        ? {
            resumeSessionId:
              typeof node.agent?.resumeSessionId === 'string' ? node.agent.resumeSessionId : null,
            verified:
              typeof node.agent?.resumeSessionIdVerified === 'boolean'
                ? node.agent.resumeSessionIdVerified
                : null,
            position:
              node.position && Number.isFinite(node.position.x) && Number.isFinite(node.position.y)
                ? { ...node.position }
                : null,
          }
        : null
    }
    const newRead = (route: string): ContinuityRead => {
      const entry: ContinuityRead = {
        seq: ++log.seq,
        route,
        source: 'pending',
        canonicalRevision: null,
        returnedRevision: null,
        candidate: null,
      }
      log.reads.push(entry)
      return entry
    }
    const parseRaw = (raw: string) => {
      try {
        return JSON.parse(raw)
      } catch {
        return null
      }
    }
    const newWrite = (
      route: string,
      state: unknown,
      baseRevision?: number | null,
    ): ContinuityWrite => {
      const submitted = candidate(state)
      const entry: ContinuityWrite = {
        get carried() {
          return submitted?.resumeSessionId === log.a
            ? 'A'
            : submitted?.resumeSessionId === log.b
              ? 'B'
              : 'other'
        },
        seq: ++log.seq,
        route,
        candidate: submitted,
        baseRevision: baseRevision ?? null,
        ok: null,
        corrected: null,
        merged: null,
        uncertain: null,
        revision: null,
      }
      log.writes.push(entry)
      return entry
    }
    const finishWrite = (entry: ContinuityWrite, value: unknown, ok?: boolean) => {
      const receipt = value as {
        ok?: boolean
        corrected?: boolean
        merged?: boolean
        uncertain?: boolean
        revision?: number
        error?: { code?: string }
      } | null
      Object.assign(entry, {
        ok: receipt?.ok ?? ok ?? false,
        corrected: receipt?.corrected ?? null,
        merged: receipt?.merged ?? null,
        uncertain: receipt?.uncertain ?? null,
        revision: receipt?.revision ?? null,
        ...(receipt?.error?.code ? { error: receipt.error.code } : {}),
      })
    }
    const failure = (entry: ContinuityRead | ContinuityWrite, error: unknown) => {
      const value = error as { code?: string; name?: string }
      entry.error = value?.code ?? value?.name ?? 'Unknown error'
    }
    const originalFetch = globalThis.fetch
    if (typeof originalFetch === 'function') {
      globalThis.fetch = async (input, init) => {
        const request =
          typeof init?.body === 'string'
            ? (parseRaw(init.body) as {
                id?: string
                payload?: { state?: unknown; raw?: string; baseRevision?: number }
              } | null)
            : null
        const isRead = request?.id === 'sync.state'
        const isWrite =
          request?.id === 'sync.writeState' || request?.id === 'sync.writeWorkspaceStateRaw'
        if (!isRead && !isWrite) {
          return await originalFetch(input, init)
        }
        const entry = isRead
          ? newRead('wire:sync.state')
          : newWrite(
              `wire:${request!.id}`,
              request?.id === 'sync.writeState'
                ? request.payload?.state
                : parseRaw(request?.payload?.raw ?? ''),
              request?.payload?.baseRevision,
            )
        let response: Response
        try {
          response = await originalFetch(input, init)
        } catch (error) {
          failure(entry, error)
          throw error
        }
        try {
          const body = (await response.clone().json()) as {
            ok?: boolean
            value?: { state?: unknown; revision?: number }
            error?: { code?: string }
          }
          if (isRead) {
            const read = entry as ContinuityRead
            Object.assign(read, {
              source: body.ok ? 'canonical' : 'error',
              canonicalRevision: body.value?.revision ?? null,
              returnedRevision: body.value?.revision ?? null,
              candidate: candidate(body.value?.state),
            })
          } else {
            finishWrite(
              entry as ContinuityWrite,
              body.ok ? body.value : { error: body.error },
              body.ok,
            )
          }
        } catch (error) {
          failure(entry, error)
        }
        return response
      }
    }
    const originalAdd = EventSource.prototype.addEventListener
    EventSource.prototype.addEventListener = function (type, callback, options) {
      if (type !== 'opencove.sync' || !callback) {
        return originalAdd.call(this, type, callback, options)
      }
      return originalAdd.call(
        this,
        type,
        event => {
          if ((window as unknown as { __dropManagedSync?: boolean }).__dropManagedSync) {
            return
          }
          if (typeof callback === 'function') {
            callback.call(this, event)
          } else {
            callback.handleEvent(event)
          }
        },
        options,
      )
    }
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      get: () => api,
      set: value => {
        api = value
        const read = api.persistence.readAppState.bind(api.persistence)
        let priorRead: Awaited<ReturnType<typeof read>> | undefined
        api.persistence.readAppState = async () => {
          const entry = newRead('public')
          const probe = window as unknown as {
            __dropManagedSync?: boolean
            __correctedManagedWrite?: boolean
          }
          const frozen = () =>
            probe.__dropManagedSync && !probe.__correctedManagedWrite && priorRead
          try {
            if (frozen()) {
              Object.assign(entry, {
                source: 'frozen',
                returnedRevision: priorRead!.revision ?? null,
                candidate: candidate(priorRead!.state),
              })
              return structuredClone(priorRead!)
            }
            const snapshot = await read()
            entry.canonicalRevision = snapshot.revision ?? null
            const result = frozen() ? priorRead! : snapshot
            Object.assign(entry, {
              source: frozen() ? 'late-frozen' : 'canonical',
              returnedRevision: result.revision ?? null,
              candidate: candidate(result.state),
            })
            log.a ??= candidate(result.state)?.resumeSessionId ?? null
            if (!frozen()) {
              priorRead = snapshot
            }
            return structuredClone(result)
          } catch (error) {
            entry.source = 'error'
            failure(entry, error)
            throw error
          }
        }
        const write = api.persistence.writeAppState.bind(api.persistence)
        api.persistence.writeAppState = async payload => {
          const entry = newWrite('structured', payload.state, payload.baseRevision)
          try {
            const receipt = await write(payload)
            finishWrite(entry, receipt)
            if (receipt.ok && (receipt.corrected || receipt.merged)) {
              Object.assign(window, { __correctedManagedWrite: true })
            }
            return receipt
          } catch (error) {
            failure(entry, error)
            throw error
          }
        }
        const raw = api.persistence.writeWorkspaceStateRaw?.bind(api.persistence)
        if (raw) {
          api.persistence.writeWorkspaceStateRaw = async payload => {
            const entry = newWrite('raw', parseRaw(payload.raw))
            try {
              const receipt = await raw(payload)
              finishWrite(entry, receipt)
              if (receipt.ok && (receipt.corrected || receipt.merged)) {
                Object.assign(window, { __correctedManagedWrite: true })
              }
              return receipt
            } catch (error) {
              failure(entry, error)
              throw error
            }
          }
        }
        const invoke = api.controlSurface.invoke.bind(api.controlSurface)
        api.controlSurface.invoke = async <T>(request: ControlSurfaceInvokeRequest): Promise<T> => {
          const result = await invoke<T>(request)
          const prepared =
            request.id === 'session.prepareOrRevive'
              ? (result as { nodes?: PreparedRuntimeNodeResult[] })?.nodes?.find(
                  node => node.nodeId === targetNodeId,
                )
              : undefined
          if (!held && prepared) {
            held = true
            log.a ??= prepared.managedClaudeBinding?.tuple.resumeSessionId ?? null
            Object.assign(window, { __heldManagedPrepare: structuredClone(prepared) })
            await new Promise<void>(resolve =>
              Object.assign(window, { __releaseManagedPrepare: resolve }),
            )
          }
          return result
        }
      },
    })
  }, nodeId)
}
export async function releasePrepare(page: Page) {
  await page.evaluate(() => {
    ;(window as unknown as { __releaseManagedPrepare?: () => void }).__releaseManagedPrepare?.()
  })
}
