import { randomUUID } from 'node:crypto'
import type {
  ResizeTerminalInput,
  TerminalGeometryCommitResult,
} from '../../../../shared/contracts/dto'
import type { TerminalSessionManager } from './sessionManager'

const LOCAL_GEOMETRY_AUTHORITY = { role: 'controller' as const, epoch: 1 }

export function createLocalPtyGeometryCommitter(options: {
  manager: Pick<
    TerminalSessionManager,
    | 'resolveSessionLifecycleState'
    | 'resolveActivePresentationSessionIdentity'
    | 'getGeometry'
    | 'planGeometryCommit'
    | 'commitGeometry'
  >
  resizeRuntime: (sessionId: string, cols: number, rows: number) => Promise<unknown>
  log: (payload: Record<string, unknown>) => void
}): {
  resize: (input: ResizeTerminalInput) => Promise<TerminalGeometryCommitResult>
  dispose: () => void
} {
  const commitChains = new Map<string, Promise<void>>()

  const enqueue = <T>(sessionId: string, commit: () => Promise<T>): Promise<T> => {
    const previous = commitChains.get(sessionId) ?? Promise.resolve()
    const current = previous.then(commit, commit)
    const tail = current.then(
      () => undefined,
      () => undefined,
    )
    commitChains.set(sessionId, tail)
    void tail.then(() => {
      if (commitChains.get(sessionId) === tail) {
        commitChains.delete(sessionId)
      }
    })
    return current
  }

  const resize = async (input: ResizeTerminalInput): Promise<TerminalGeometryCommitResult> => {
    const operationId = input.operationId?.trim() || randomUUID()
    const normalizedInput: ResizeTerminalInput = { ...input, operationId }
    const sessionNotFound = (): TerminalGeometryCommitResult => ({
      sessionId: input.sessionId,
      operationId,
      status: 'session_not_found',
      changed: false,
      geometry: null,
      authority: null,
    })
    if (options.manager.resolveSessionLifecycleState(input.sessionId) !== 'active') {
      return sessionNotFound()
    }
    if (options.manager.resolveActivePresentationSessionIdentity(input.sessionId) === null) {
      return sessionNotFound()
    }
    if (
      input.authorityEpoch !== null &&
      input.authorityEpoch !== undefined &&
      input.authorityEpoch !== LOCAL_GEOMETRY_AUTHORITY.epoch
    ) {
      return {
        sessionId: input.sessionId,
        operationId,
        status: 'rejected_stale_authority',
        changed: false,
        geometry: options.manager.getGeometry(input.sessionId),
        authority: LOCAL_GEOMETRY_AUTHORITY,
      }
    }

    return await enqueue(input.sessionId, async () => {
      const presentationIdentity = options.manager.resolveActivePresentationSessionIdentity(
        input.sessionId,
      )
      if (!presentationIdentity) {
        return sessionNotFound()
      }

      const plan = options.manager.planGeometryCommit(normalizedInput)
      if (plan.status === 'superseded') {
        return {
          sessionId: input.sessionId,
          operationId,
          status: 'superseded',
          changed: false,
          geometry: plan.geometry,
          authority: LOCAL_GEOMETRY_AUTHORITY,
        }
      }

      if (!plan.changed) {
        const committed = options.manager.commitGeometry(normalizedInput)
        return {
          sessionId: input.sessionId,
          operationId,
          status: committed.status,
          changed: false,
          geometry: committed.geometry,
          authority: LOCAL_GEOMETRY_AUTHORITY,
        }
      }

      try {
        await options.resizeRuntime(input.sessionId, plan.geometry.cols, plan.geometry.rows)
      } catch (error) {
        const geometry = options.manager.getGeometry(input.sessionId)
        options.log({
          event: 'runtime-failed',
          sessionId: input.sessionId,
          requestedCols: input.cols,
          requestedRows: input.rows,
          reason: input.reason,
          operationId,
          error: error instanceof Error ? error.message : String(error),
        })
        return {
          sessionId: input.sessionId,
          operationId,
          status: 'runtime_failed',
          changed: false,
          geometry,
          authority: LOCAL_GEOMETRY_AUTHORITY,
        }
      }

      if (
        options.manager.resolveActivePresentationSessionIdentity(input.sessionId) !==
        presentationIdentity
      ) {
        return sessionNotFound()
      }

      const committed = options.manager.commitGeometry(normalizedInput)
      if (committed.status === 'superseded') {
        return {
          sessionId: input.sessionId,
          operationId,
          status: 'superseded',
          changed: false,
          geometry: committed.geometry,
          authority: LOCAL_GEOMETRY_AUTHORITY,
        }
      }

      options.log({
        event: committed.changed ? 'forwarded' : 'unchanged',
        sessionId: input.sessionId,
        requestedCols: input.cols,
        requestedRows: input.rows,
        cols: committed.geometry.cols,
        rows: committed.geometry.rows,
        reason: input.reason,
        revision: committed.geometry.revision,
        operationId,
      })
      return {
        sessionId: input.sessionId,
        operationId,
        status: 'accepted',
        changed: committed.changed,
        geometry: committed.geometry,
        authority: LOCAL_GEOMETRY_AUTHORITY,
      }
    })
  }

  return {
    resize,
    dispose: () => commitChains.clear(),
  }
}
