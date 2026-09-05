import { join } from 'node:path'
import type { ManagedSshOperationLifecycleEvent } from '../../../../contexts/topology/application/ManagedSshEndpointOperationOwner'
import { appendBoundedRuntimeDiagnosticsLine } from '../../../../platform/persistence/runtimeDiagnosticsFile'

export function createManagedSshOperationDiagnosticSink(
  userDataPath: string,
): (event: ManagedSshOperationLifecycleEvent) => void {
  const file = join(userDataPath, 'logs', 'runtime-diagnostics.log')
  return event => {
    try {
      appendBoundedRuntimeDiagnosticsLine(
        file,
        JSON.stringify({
          ts: new Date().toISOString(),
          source: 'managed-ssh',
          level: event.type === 'failed' ? 'error' : 'info',
          event: `managed-ssh-operation-${event.type}`,
          details: {
            endpointId: event.endpointId,
            operationId: event.operationId,
            kind: event.kind,
            phase: event.phase,
            revision: event.revision,
            elapsedMs: event.elapsedMs,
            ...(event.type === 'failed' ? { failureKind: event.failureKind } : {}),
          },
        }),
      )
    } catch {
      // Diagnostic I/O is not operation authority.
    }
  }
}
