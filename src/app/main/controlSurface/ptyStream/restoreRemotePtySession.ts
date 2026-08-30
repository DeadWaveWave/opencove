import type {
  ListSessionsResult,
  PresentationSnapshotTerminalResult,
} from '../../../../shared/contracts/dto'
import type { createRemoteRecoveryCheckpointFence } from './remoteRecoveryCheckpointFence'
import type { RemotePtyEndpointProxy } from './remotePtyEndpointProxy'
import { RemotePtyRecoveryBlockedError } from './RemotePtyRecoveryBlockedError'

type SessionRoute =
  | { kind: 'local' }
  | { kind: 'remote'; endpointId: string; remoteSessionId: string }

type RetiredRemoteCursor = {
  endpointId: string
  remoteSessionId: string
  cursor: number | null
}

export async function restoreRemotePtySession(options: {
  homeSessionId: string
  endpointId: string
  remoteSessionId: string
  targetWorkerInstanceId?: string | null
  afterSeq?: number | null
  beforeAttach: (
    session: ListSessionsResult['sessions'][number],
    presentationSnapshot: PresentationSnapshotTerminalResult | null,
    publishRecoveryBaseline: () => void,
  ) => void | Promise<void>
  routes: Map<string, SessionRoute>
  homeSessionIdByRemote: Map<string, string>
  remoteByHomeSessionId: Map<string, { endpointId: string; remoteSessionId: string }>
  retiredRemoteCursorByHomeSessionId: Map<string, RetiredRemoteCursor>
  recoveryCheckpointFence: ReturnType<typeof createRemoteRecoveryCheckpointFence>
  getProxy: (endpointId: string) => RemotePtyEndpointProxy
}): Promise<ListSessionsResult['sessions'][number] | null> {
  const {
    homeSessionId,
    endpointId,
    remoteSessionId,
    targetWorkerInstanceId,
    afterSeq,
    beforeAttach,
  } = options
  if (options.routes.has(homeSessionId) || options.remoteByHomeSessionId.has(homeSessionId)) {
    return null
  }
  const remoteKey = `${endpointId}:${remoteSessionId}`
  if (options.homeSessionIdByRemote.has(remoteKey)) {
    return null
  }

  const proxy = options.getProxy(endpointId)
  const restoredSession = await proxy.findSession(remoteSessionId, targetWorkerInstanceId)
  if (!restoredSession || restoredSession.kind !== 'terminal') {
    return null
  }
  const presentationSnapshot = await proxy.presentationSnapshot(remoteSessionId).catch(() => null)
  if (
    !presentationSnapshot &&
    (restoredSession.status !== 'running' || typeof afterSeq !== 'number')
  ) {
    throw new RemotePtyRecoveryBlockedError()
  }
  const resumeAfterSeq = presentationSnapshot?.appliedSeq ?? afterSeq

  const settleRecoveryBaseline =
    options.recoveryCheckpointFence.beginPresentationTransition(homeSessionId)
  let recoveryBaselinePublished = false
  const publishRecoveryBaseline = (): void => {
    if (recoveryBaselinePublished) {
      return
    }
    recoveryBaselinePublished = true
    settleRecoveryBaseline(true)
  }
  options.routes.set(homeSessionId, { kind: 'remote', endpointId, remoteSessionId })
  options.retiredRemoteCursorByHomeSessionId.delete(homeSessionId)
  options.homeSessionIdByRemote.set(remoteKey, homeSessionId)
  options.remoteByHomeSessionId.set(homeSessionId, { endpointId, remoteSessionId })
  proxy.prepareAttach(remoteSessionId, resumeAfterSeq)
  try {
    await beforeAttach(restoredSession, presentationSnapshot, publishRecoveryBaseline)
    if (!recoveryBaselinePublished) {
      throw new Error(`Remote recovery baseline was not published: ${homeSessionId}`)
    }
  } catch (error) {
    settleRecoveryBaseline(false)
    options.routes.delete(homeSessionId)
    options.homeSessionIdByRemote.delete(remoteKey)
    options.remoteByHomeSessionId.delete(homeSessionId)
    proxy.forget(remoteSessionId)
    throw error
  }
  if (restoredSession.status !== 'running') {
    options.routes.delete(homeSessionId)
    options.homeSessionIdByRemote.delete(remoteKey)
    options.remoteByHomeSessionId.delete(homeSessionId)
    proxy.forget(remoteSessionId)
    return restoredSession
  }
  proxy.attach(remoteSessionId, resumeAfterSeq)
  return restoredSession
}
