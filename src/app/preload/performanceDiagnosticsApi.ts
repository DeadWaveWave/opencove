import { IPC_CHANNELS } from '../../shared/contracts/ipc'
import type { PerformanceDiagnosticsSnapshotResult } from '../../shared/contracts/dto'
import { invokeIpc } from './ipcInvoke'

export function createPerformanceDiagnosticsPreloadApi(): {
  getSnapshot: () => Promise<PerformanceDiagnosticsSnapshotResult>
} {
  return {
    getSnapshot: (): Promise<PerformanceDiagnosticsSnapshotResult> =>
      invokeIpc(IPC_CHANNELS.performanceDiagnosticsSnapshot),
  }
}
