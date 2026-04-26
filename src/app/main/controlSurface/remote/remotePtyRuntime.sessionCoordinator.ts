import { webContents } from 'electron'
import WebSocket from 'ws'
import type { AttachedSessionState } from './remotePtyStreamMessageHandler'

type SessionRole = 'viewer' | 'controller'

export type RemotePtySessionCoordinator = {
  attachedSessions: Map<string, AttachedSessionState>
  trackSession: (sessionId: string) => void
  untrackSession: (sessionId: string) => void
  trackWebContentsDestroyed: (contentsId: number) => void
  addSubscriber: (contentsId: number, sessionId: string) => void
  removeSubscriber: (contentsId: number, sessionId: string) => Promise<void>
  noteSessionRolePreference: (sessionId: string, role: SessionRole) => void
  onSessionAttached: (sessionId: string) => void
  onSocketClosed: () => void
  waitForSessionAttached: (sessionId: string) => Promise<void>
  sendAttachForSession: (ws: WebSocket, sessionId: string) => void
  forEachTrackedSession: (callback: (sessionId: string) => void) => void
  hasTrackedSession: (sessionId: string) => boolean
  hasTrackedSessions: () => boolean
  updateAttachedSeq: (sessionId: string, seq: number) => void
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
  const pendingSessionAttachWaiters = new Map<string, Set<() => void>>()

  const maybeCloseSocket = (): void => {
    if (!options.shouldKeepSocketAlive()) {
      options.closeSocket()
    }
  }

  const clearStreamAttachmentState = (sessionId: string): void => {
    streamAttachedSessionIds.delete(sessionId)
    streamAttachRequestedSessionIds.delete(sessionId)
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

  const untrackSession = (sessionId: string): void => {
    const normalizedSessionId = sessionId.trim()
    if (normalizedSessionId.length === 0) {
      return
    }

    trackedSessionIds.delete(normalizedSessionId)
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
    const pendingAttachSessionIds = [...pendingSessionAttachWaiters.keys()]
    pendingSessionAttachWaiters.clear()
    pendingAttachSessionIds.forEach(sessionId => {
      streamAttachRequestedSessionIds.delete(sessionId)
    })
    streamAttachedSessionIds.clear()
    streamAttachRequestedSessionIds.clear()
  }

  const onSessionAttached = (sessionId: string): void => {
    streamAttachedSessionIds.add(sessionId)
    const waiters = pendingSessionAttachWaiters.get(sessionId)
    if (!waiters) {
      return
    }

    pendingSessionAttachWaiters.delete(sessionId)
    waiters.forEach(resolve => resolve())
  }

  const waitForSessionAttached = (sessionId: string): Promise<void> => {
    if (streamAttachedSessionIds.has(sessionId)) {
      return Promise.resolve()
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiters = pendingSessionAttachWaiters.get(sessionId)
        waiters?.delete(handleResolve)
        if (waiters && waiters.size === 0) {
          pendingSessionAttachWaiters.delete(sessionId)
        }
        streamAttachRequestedSessionIds.delete(sessionId)
        reject(new Error(`Timed out waiting for PTY attach: ${sessionId}`))
      }, options.connectTimeoutMs)

      const handleResolve = () => {
        clearTimeout(timer)
        resolve()
      }

      const waiters = pendingSessionAttachWaiters.get(sessionId) ?? new Set<() => void>()
      waiters.add(handleResolve)
      pendingSessionAttachWaiters.set(sessionId, waiters)
    })
  }

  const sendAttachForSession = (ws: WebSocket, sessionId: string): void => {
    if (streamAttachRequestedSessionIds.has(sessionId) || !trackedSessionIds.has(sessionId)) {
      return
    }

    const state = attachedSessions.get(sessionId) ?? { lastSeq: 0 }
    attachedSessions.set(sessionId, state)

    ws.send(
      JSON.stringify({
        type: 'attach',
        sessionId,
        ...(state.lastSeq > 0 ? { afterSeq: state.lastSeq } : {}),
        role: rolePreferenceBySessionId.get(sessionId) ?? 'controller',
      }),
    )

    streamAttachRequestedSessionIds.add(sessionId)
  }

  const addSubscriber = (contentsId: number, sessionId: string): void => {
    const sessionSubscribers = subscribersBySessionId.get(sessionId) ?? new Set<number>()
    sessionSubscribers.add(contentsId)
    subscribersBySessionId.set(sessionId, sessionSubscribers)

    const sessions = sessionsByContentsId.get(contentsId) ?? new Set<string>()
    sessions.add(sessionId)
    sessionsByContentsId.set(contentsId, sessions)
  }

  const removeSubscriber = async (contentsId: number, sessionId: string): Promise<void> => {
    const sessions = sessionsByContentsId.get(contentsId)
    sessions?.delete(sessionId)
    if (sessions && sessions.size === 0) {
      sessionsByContentsId.delete(contentsId)
    }

    const sessionSubscribers = subscribersBySessionId.get(sessionId)
    sessionSubscribers?.delete(contentsId)
    if (sessionSubscribers && sessionSubscribers.size === 0) {
      subscribersBySessionId.delete(sessionId)
      await detachStreamSessionIfUntracked(sessionId)
    }

    maybeCloseSocket()
  }

  const noteSessionRolePreference = (sessionId: string, role: SessionRole): void => {
    rolePreferenceBySessionId.set(sessionId, role)
    if (!attachedSessions.has(sessionId)) {
      attachedSessions.set(sessionId, { lastSeq: 0 })
    }
    trackSession(sessionId)
  }

  const updateAttachedSeq = (sessionId: string, seq: number): void => {
    const normalizedSessionId = sessionId.trim()
    if (normalizedSessionId.length === 0) {
      return
    }

    const state = attachedSessions.get(normalizedSessionId) ?? { lastSeq: 0 }
    state.lastSeq = Math.max(state.lastSeq, seq)
    attachedSessions.set(normalizedSessionId, state)
  }

  const clear = (): void => {
    subscribersBySessionId.clear()
    sessionsByContentsId.clear()
    attachedSessions.clear()
    trackedSessionIds.clear()
    streamAttachRequestedSessionIds.clear()
    streamAttachedSessionIds.clear()
    rolePreferenceBySessionId.clear()
    pendingSessionAttachWaiters.clear()
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
    updateAttachedSeq,
    clear,
  }
}
