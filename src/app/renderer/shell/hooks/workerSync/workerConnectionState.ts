import { currentManagedClaudeCompatibilityNotice } from '@contexts/workspace/presentation/renderer/utils/managedClaudeCompatibilityNotice'
import { toErrorMessage } from '../../utils/format'
import { useAppStore } from '../../store/useAppStore'
import { toAppErrorDescriptor } from '@shared/errors/appError'
import {
  persistenceScope,
  setPublicationConnectionError,
} from '@contexts/workspace/presentation/renderer/utils/persistence/publicationState'

/** Publication owns the block; application state exposes the typed reason to the UI. */
export function reportWorkerConnectionFailure(error: unknown): void {
  persistenceScope()
  const descriptor = toAppErrorDescriptor(error, 'persistence.unavailable')
  setPublicationConnectionError(descriptor)
  useAppStore.setState({
    workerConnectionError: descriptor,
    persistNotice: { tone: 'error', kind: 'connection', message: toErrorMessage(descriptor) },
  })
}
export function clearWorkerConnectionFailure(): void {
  setPublicationConnectionError(null)
  if (useAppStore.getState().workerConnectionError) {
    useAppStore.setState(state => ({
      workerConnectionError: null,
      persistNotice:
        state.persistNotice?.kind === 'connection'
          ? currentManagedClaudeCompatibilityNotice()
          : state.persistNotice,
    }))
  }
}
export const WORKER_CONNECTION_RETRY_EVENT = 'opencove.retryWorkerConnection'
