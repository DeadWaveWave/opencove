import type { WorkerTopologyStore } from '../topology/topologyStore'
import type {
  TerminalForegroundEvent,
  TerminalSessionStateEvent,
  TerminalSessionMetadataEvent,
  PresentationSnapshotTerminalResult,
} from '../../../../shared/contracts/dto'

export type RemotePtyEndpointProxyOptions = {
  endpointId: string
  topology: WorkerTopologyStore
  emitData: (remoteSessionId: string, data: string) => void
  emitExit: (remoteSessionId: string, exitCode: number) => void
  emitForeground: (remoteSessionId: string, event: TerminalForegroundEvent) => void
  emitState: (remoteSessionId: string, event: TerminalSessionStateEvent) => void
  emitMetadata: (remoteSessionId: string, metadata: TerminalSessionMetadataEvent) => void
  emitPresentationReset: (
    remoteSessionId: string,
    snapshot: PresentationSnapshotTerminalResult,
  ) => Promise<void>
  emitPresentationResetCommitted: (remoteSessionId: string, committed: boolean) => void
}
