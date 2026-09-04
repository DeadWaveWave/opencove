import { webContents } from 'electron'
import WebSocket from 'ws'
import type {
  AttachTerminalResult,
  TerminalGeometryAuthority,
} from '../../../../shared/contracts/dto'
import type { AttachedSessionState } from './remotePtyStreamMessageHandler'

type SessionRole = 'viewer' | 'controller'
type AttachWaiter = {
  resolve: (result: AttachTerminalResult) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

function createAttachedSessionState(): AttachedSessionState {
  return { lastSeq: 0, role: 'viewer', authorityEpoch: null }
}

export type RemotePtySessionCoordinator = {
  attachedSessions: Map<string, AttachedSessionState>
  trackSession: (sessionId: string) => void
  untrackSession: (sessionId: string, error?: Error) => void
  trackWebContentsDestroyed: (contentsId: number) => void
  addSubscriber: (contentsId: number, sessionId: string, afterSeq?: number | null) => void
  removeSubscriber: (contentsId: number, sessionId: string) => Promise<void>
  noteSessionRolePreference: (sessionId: string, role: SessionRole) => void
  onSessionAttached: (sessionId: string, authority: TerminalGeometryAuthority) => void
  onAuthorityChanged: (sessionId: string, authority: TerminalGeometryAuthority) => void
  onSocketClosed: () => void
  waitForSessionAttached: (sessionId: string) => Promise<AttachTerminalResult>
  sendAttachForSession: (ws: WebSocket, sessionId: string) => void
  forEachTrackedSession: (callback: (sessionId: string) => void) => void
  hasTrackedSession: (sessionId: string) => boolean
  hasTrackedSessions: () => boolean
  isStreamAttached: (sessionId: string) => boolean
  updateAttachedSeq: (sessionId: string, seq: number) => void
  noteSubscriberSeq: (sessionId: string, contentsId: number, seq: number) => void
  clear: () => void
}

export function createRemotePtySessionCoordinator(options: {
  connectTimeoutMs: number
  cancelMetadataWatcher: (sessionId: string) => void
  shouldKeepSocketAlive: () => boolean
  closeSocket: () => void
  sendDetachMessage: (sessionId: string) => Promise<void>
}): RemotePtySessionCoordinator & {
  subscribersBySessionId: Map<string, Set<number>>
  sessionsByContentsId: Map<number, Set<string>>
  rolePreferenceBySessionId: Map<string, SessionRole>
} {
  const subscribersBySessionId = new Map<string, Set<number>>()
  const sessionsByContentsId = new Map<number, Set<string>>()
  const attachedSessions = new Map<string, AttachedSessionState>()
  const trackedSessionIds = new Set<string>()
  const streamAttachRequestedSessionIds = new Set<string>()
  const streamAttachedSessionIds = new Set<string>()
  const rolePreferenceBySessionId = new Map<string, SessionRole>()
  const subscriberSeqBySessionId = new Map<string, Map<number, number>>()
  const pendingSessionAttachWaiters = new Map<string, Set<AttachWaiter>>()
  const attachedResultBySessionId = new Map<string, AttachTerminalResult>()

  const maybeCloseSocket = (): void => {
    if (!options.shouldKeepSocketAlive()) {
      options.closeSocket()
    }
  }

  const clearStreamAttachmentState = (sessionId: string): void => {
    streamAttachedSessionIds.delete(sessionId)
    streamAttachRequestedSessionIds.delete(sessionId)
    attachedResultBySessionId.delete(sessionId)
  }

  const detachStreamSessionIfUntracked = async (sessionId: string): Promise<void> => {
    if (trackedSessionIds.has(sessionId)) {
      return
    }

    clearStreamAttachmentState(sessionId)
    await options.sendDetachMessage(sessionId)
  }

  const trackSession = (sessionId: string): void => {
    const normalizedSessionId = sessionId.trim()
    if (normalizedSessionId.length === 0) {
      return
    }

    trackedSessionIds.add(normalizedSessionId)
  }

  const rejectPendingAttach = (sessionId: string, error: Error): void => {
    const waiters = pendingSessionAttachWaiters.get(sessionId)
    pendingSessionAttachWaiters.delete(sessionId)
    waiters?.forEach(waiter => {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    })
  }

  const untrackSession = (
    sessionId: string,
    error = new Error(`Terminal session is no longer tracked: ${sessionId}`),
  ): void => {
    const normalizedSessionId = sessionId.trim()
    if (normalizedSessionId.length === 0) {
      return
    }

    trackedSessionIds.delete(normalizedSessionId)
    clearStreamAttachmentState(normalizedSessionId)
    attachedSessions.delete(normalizedSessionId)
    subscriberSeqBySessionId.delete(normalizedSessionId)
    rejectPendingAttach(normalizedSessionId, error)
    options.cancelMetadataWatcher(normalizedSessionId)
    maybeCloseSocket()
  }

  const cleanupContents = (contentsId: number): void => {
    const sessions = sessionsByContentsId.get(contentsId)
    if (!sessions) {
      return
    }

    for (const sessionId of sessions) {
      const subscribers = subscribersBySessionId.get(sessionId)
      subscribers?.delete(contentsId)
      const subscriberSeq = subscriberSeqBySessionId.get(sessionId)
      subscriberSeq?.delete(contentsId)
      if (subscriberSeq?.size === 0) {
        subscriberSeqBySessionId.delete(sessionId)
      }
      if (subscribers && subscribers.size === 0) {
        subscribersBySessionId.delete(sessionId)
        void detachStreamSessionIfUntracked(sessionId).catch(() => undefined)
      }
    }

    sessionsByContentsId.delete(contentsId)
    maybeCloseSocket()
  }

  const trackWebContentsDestroyed = (contentsId: number): void => {
    if (sessionsByContentsId.has(contentsId)) {
      return
    }

    const content = webContents.fromId(contentsId)
    if (!content || content.isDestroyed() || content.getType() !== 'window') {
      return
    }

    content.once('destroyed', () => cleanupContents(contentsId))
  }

  const onSocketClosed = (): void => {
    const error = new Error('PTY stream connection closed before attach acknowledgement.')
    for (const waiters of pendingSessionAttachWaiters.values()) {
      waiters.forEach(waiter => {
        clearTimeout(waiter.timer)
        waiter.reject(error)
      })
    }
    pendingSessionAttachWaiters.clear()
    attachedResultBySessionId.clear()
    streamAttachedSessionIds.clear()
    streamAttachRequestedSessionIds.clear()
    attachedSessions.forEach(state => {
      state.role = 'viewer'
      state.authorityEpoch = null
    })
  }

  const onSessionAttached = (sessionId: string, authority: TerminalGeometryAuthority): void => {
    if (!trackedSessionIds.has(sessionId) || !streamAttachRequestedSessionIds.has(sessionId)) {
      return
    }
    const result = { sessionId, authority }
    attachedResultBySessionId.set(sessionId, result)
    streamAttachedSessionIds.add(sessionId)
    const waiters = pendingSessionAttachWaiters.get(sessionId)
    if (!waiters) {
      return
    }

    pendingSessionAttachWaiters.delete(sessionId)
    waiters.forEach(waiter => {
      clearTimeout(waiter.timer)
      waiter.resolve(result)
    })
  }

  const onAuthorityChanged = (sessionId: string, authority: TerminalGeometryAuthority): void => {
    if (streamAttachedSessionIds.has(sessionId)) {
      attachedResultBySessionId.set(sessionId, { sessionId, authority })
    }
  }

  const waitForSessionAttached = (sessionId: string): Promise<AttachTerminalResult> => {
    if (!trackedSessionIds.has(sessionId)) {
      return Promise.reject(new Error(`Terminal session is no longer tracked: ${sessionId}`))
    }
    const attachedResult = attachedResultBySessionId.get(sessionId)
    if (streamAttachedSessionIds.has(sessionId) && attachedResult) {
      return Promise.resolve(attachedResult)
    }

    return new Promise<AttachTerminalResult>((resolve, reject) => {
      const waiter = {} as AttachWaiter
      waiter.resolve = resolve
      waiter.reject = reject
      waiter.timer = setTimeout(() => {
        const waiters = pendingSessionAttachWaiters.get(sessionId)
        waiters?.delete(waiter)
        if (waiters && waiters.size === 0) {
          pendingSessionAttachWaiters.delete(sessionId)
        }
        streamAttachRequestedSessionIds.delete(sessionId)
        reject(new Error(`Timed out waiting for PTY attach: ${sessionId}`))
      }, options.connectTimeoutMs)

      const waiters = pendingSessionAttachWaiters.get(sessionId) ?? new Set<AttachWaiter>()
      waiters.add(waiter)
      pendingSessionAttachWaiters.set(sessionId, waiters)
    })
  }

  const sendAttachForSession = (ws: WebSocket, sessionId: string): void => {
    if (streamAttachRequestedSessionIds.has(sessionId) || !trackedSessionIds.has(sessionId)) {
      return
    }

    const state = attachedSessions.get(sessionId) ?? createAttachedSessionState()
    attachedSessions.set(sessionId, state)
    const subscriberSeq = subscriberSeqBySessionId.get(sessionId)
    const replayAfterSeq = subscriberSeq?.size ? Math.min(...subscriberSeq.values()) : state.lastSeq

    ws.send(
      JSON.stringify({
        type: 'attach',
        sessionId,
        ...(replayAfterSeq > 0 ? { afterSeq: replayAfterSeq } : {}),
        role: rolePreferenceBySessionId.get(sessionId) ?? 'controller',
      }),
    )

    streamAttachRequestedSessionIds.add(sessionId)
  }

  const addSubscriber = (
    contentsId: number,
    sessionId: string,
    afterSeq: number | null = null,
  ): void => {
    const sessionSubscribers = subscribersBySessionId.get(sessionId) ?? new Set<number>()
    sessionSubscribers.add(contentsId)
    subscribersBySessionId.set(sessionId, sessionSubscribers)

    const sessions = sessionsByContentsId.get(contentsId) ?? new Set<string>()
    sessions.add(sessionId)
    sessionsByContentsId.set(contentsId, sessions)

    const subscriberSeq = subscriberSeqBySessionId.get(sessionId) ?? new Map<number, number>()
    const normalizedAfterSeq =
      typeof afterSeq === 'number' && Number.isSafeInteger(afterSeq) && afterSeq >= 0 ? afterSeq : 0
    subscriberSeq.set(contentsId, Math.max(subscriberSeq.get(contentsId) ?? 0, normalizedAfterSeq))
    subscriberSeqBySessionId.set(sessionId, subscriberSeq)
  }

  const removeSubscriber = async (contentsId: number, sessionId: string): Promise<void> => {
    const sessions = sessionsByContentsId.get(contentsId)
    sessions?.delete(sessionId)
    if (sessions && sessions.size === 0) {
      sessionsByContentsId.delete(contentsId)
    }

    const sessionSubscribers = subscribersBySessionId.get(sessionId)
    sessionSubscribers?.delete(contentsId)
    const subscriberSeq = subscriberSeqBySessionId.get(sessionId)
    subscriberSeq?.delete(contentsId)
    if (subscriberSeq?.size === 0) {
      subscriberSeqBySessionId.delete(sessionId)
    }
    if (sessionSubscribers && sessionSubscribers.size === 0) {
      subscribersBySessionId.delete(sessionId)
      await detachStreamSessionIfUntracked(sessionId)
    }

    maybeCloseSocket()
  }

  const noteSessionRolePreference = (sessionId: string, role: SessionRole): void => {
    rolePreferenceBySessionId.set(sessionId, role)
    if (!attachedSessions.has(sessionId)) {
      attachedSessions.set(sessionId, createAttachedSessionState())
    }
    trackSession(sessionId)
  }

  const noteSubscriberSeq = (sessionId: string, contentsId: number, seq: number): void => {
    const subscriberSeq = subscriberSeqBySessionId.get(sessionId)
    if (!subscriberSeq?.has(contentsId) || !Number.isSafeInteger(seq) || seq < 0) {
      return
    }
    subscriberSeq.set(contentsId, Math.max(subscriberSeq.get(contentsId) ?? 0, seq))
  }

  const updateAttachedSeq = (sessionId: string, seq: number): void => {
    const normalizedSessionId = sessionId.trim()
    if (normalizedSessionId.length === 0) {
      return
    }

    const state = attachedSessions.get(normalizedSessionId) ?? createAttachedSessionState()
    state.lastSeq = Math.max(state.lastSeq, seq)
    attachedSessions.set(normalizedSessionId, state)
  }

  const clear = (): void => {
    const error = new Error('PTY session coordinator disposed before attach acknowledgement.')
    for (const sessionId of pendingSessionAttachWaiters.keys()) {
      rejectPendingAttach(sessionId, error)
    }
    subscribersBySessionId.clear()
    sessionsByContentsId.clear()
    attachedSessions.clear()
    trackedSessionIds.clear()
    streamAttachRequestedSessionIds.clear()
    streamAttachedSessionIds.clear()
    rolePreferenceBySessionId.clear()
    subscriberSeqBySessionId.clear()
    pendingSessionAttachWaiters.clear()
    attachedResultBySessionId.clear()
  }

  return {
    subscribersBySessionId,
    sessionsByContentsId,
    attachedSessions,
    rolePreferenceBySessionId,
    trackSession,
    untrackSession,
    trackWebContentsDestroyed,
    addSubscriber,
    removeSubscriber,
    noteSessionRolePreference,
    onSessionAttached,
    onAuthorityChanged,
    onSocketClosed,
    waitForSessionAttached,
    sendAttachForSession,
    forEachTrackedSession: callback => {
      for (const sessionId of trackedSessionIds.values()) {
        callback(sessionId)
      }
    },
    hasTrackedSession: sessionId => trackedSessionIds.has(sessionId),
    hasTrackedSessions: () => trackedSessionIds.size > 0,
    isStreamAttached: sessionId => streamAttachedSessionIds.has(sessionId),
    updateAttachedSeq,
    noteSubscriberSeq,
    clear,
  }
}
