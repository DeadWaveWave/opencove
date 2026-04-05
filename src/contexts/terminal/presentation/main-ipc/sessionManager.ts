import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type { TerminalDataEvent, TerminalExitEvent } from '../../../../shared/contracts/dto'
import {
  appendSnapshotData,
  createEmptySnapshotState,
  snapshotToString,
} from '../../../../platform/process/pty/snapshot'
import type { SnapshotState } from '../../../../platform/process/pty/snapshot'
import type {
  SessionStateWatcherStartInput,
  createSessionStateWatcherController,
} from './sessionStateWatcher'

const PTY_DATA_FLUSH_DELAY_MS = 32
const PTY_DATA_HIGH_VOLUME_FLUSH_DELAY_MS = 64
const PTY_DATA_HIGH_VOLUME_BATCH_CHARS = 32_000
const PTY_DATA_MAX_BATCH_CHARS = 256_000

export interface SessionManagerDeps {
  sendToAllWindows: <T>(channel: string, payload: T) => void
  sendPtyDataToSubscriber: (contentsId: number, eventPayload: TerminalDataEvent) => void
  trackWebContentsDestroyed: (contentsId: number, onDestroyed: () => void) => boolean
  sessionStateWatcher: ReturnType<typeof createSessionStateWatcherController>
  onProbeSubscriptionChanged: (sessionId: string) => void
}

export class TerminalSessionManager {
  private readonly sendToAllWindows: SessionManagerDeps['sendToAllWindows']
  private readonly sendPtyDataToSubscriber: SessionManagerDeps['sendPtyDataToSubscriber']
  private readonly trackWebContentsDestroyed: SessionManagerDeps['trackWebContentsDestroyed']
  private readonly sessionStateWatcher: SessionManagerDeps['sessionStateWatcher']
  private readonly onProbeSubscriptionChanged: SessionManagerDeps['onProbeSubscriptionChanged']

  private readonly activeSessions = new Set<string>()
  private readonly terminatedSessions = new Set<string>()
  private readonly snapshots = new Map<string, SnapshotState>()

  private readonly pendingPtyDataChunksBySession = new Map<string, string[]>()
  private readonly pendingPtyDataCharsBySession = new Map<string, number>()
  private readonly pendingPtyDataFlushTimerBySession = new Map<string, NodeJS.Timeout>()
  private readonly pendingPtyDataFlushDelayBySession = new Map<string, number>()

  private readonly ptyDataSubscribersBySessionId = new Map<string, Set<number>>()
  private readonly ptyDataSessionsByWebContentsId = new Map<number, Set<string>>()
  private readonly ptyDataSubscribedWebContentsIds = new Set<number>()

  constructor(deps: SessionManagerDeps) {
    this.sendToAllWindows = deps.sendToAllWindows
    this.sendPtyDataToSubscriber = deps.sendPtyDataToSubscriber
    this.trackWebContentsDestroyed = deps.trackWebContentsDestroyed
    this.sessionStateWatcher = deps.sessionStateWatcher
    this.onProbeSubscriptionChanged = deps.onProbeSubscriptionChanged
  }

  // --- Subscription lifecycle ---

  private cleanupPtyDataSubscriptions(contentsId: number): void {
    const sessions = this.ptyDataSessionsByWebContentsId.get(contentsId)
    if (!sessions) {
      return
    }

    this.ptyDataSessionsByWebContentsId.delete(contentsId)

    for (const sessionId of sessions) {
      const subscribers = this.ptyDataSubscribersBySessionId.get(sessionId)
      if (!subscribers) {
        continue
      }

      subscribers.delete(contentsId)
      if (subscribers.size === 0) {
        this.ptyDataSubscribersBySessionId.delete(sessionId)
      }

      this.onProbeSubscriptionChanged(sessionId)
    }
  }

  private cleanupSessionPtyDataSubscriptions(sessionId: string): void {
    const subscribers = this.ptyDataSubscribersBySessionId.get(sessionId)
    if (!subscribers) {
      return
    }

    this.ptyDataSubscribersBySessionId.delete(sessionId)

    for (const contentsId of subscribers) {
      const sessions = this.ptyDataSessionsByWebContentsId.get(contentsId)
      sessions?.delete(sessionId)
      if (sessions && sessions.size === 0) {
        this.ptyDataSessionsByWebContentsId.delete(contentsId)
      }
    }
  }

  private trackWebContentsSubscriptionLifecycle(contentsId: number): void {
    if (this.ptyDataSubscribedWebContentsIds.has(contentsId)) {
      return
    }

    const tracked = this.trackWebContentsDestroyed(contentsId, () => {
      this.ptyDataSubscribedWebContentsIds.delete(contentsId)
      this.cleanupPtyDataSubscriptions(contentsId)
    })

    if (tracked) {
      this.ptyDataSubscribedWebContentsIds.add(contentsId)
    }
  }

  // --- Data broadcasting ---

  hasPtyDataSubscribers(sessionId: string): boolean {
    const subscribers = this.ptyDataSubscribersBySessionId.get(sessionId)
    return Boolean(subscribers && subscribers.size > 0)
  }

  private sendPtyDataToSubscribers(eventPayload: TerminalDataEvent): void {
    const subscribers = this.ptyDataSubscribersBySessionId.get(eventPayload.sessionId)
    if (!subscribers || subscribers.size === 0) {
      return
    }

    for (const contentsId of subscribers) {
      this.sendPtyDataToSubscriber(contentsId, eventPayload)
    }
  }

  private resolvePtyDataFlushDelay(pendingChars: number): number {
    return pendingChars >= PTY_DATA_HIGH_VOLUME_BATCH_CHARS
      ? PTY_DATA_HIGH_VOLUME_FLUSH_DELAY_MS
      : PTY_DATA_FLUSH_DELAY_MS
  }

  private flushPtyDataBroadcast(sessionId: string): void {
    const timer = this.pendingPtyDataFlushTimerBySession.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      this.pendingPtyDataFlushTimerBySession.delete(sessionId)
    }

    this.pendingPtyDataFlushDelayBySession.delete(sessionId)

    const chunks = this.pendingPtyDataChunksBySession.get(sessionId)
    if (!chunks || chunks.length === 0) {
      this.pendingPtyDataChunksBySession.delete(sessionId)
      this.pendingPtyDataCharsBySession.delete(sessionId)
      return
    }

    this.pendingPtyDataChunksBySession.delete(sessionId)
    this.pendingPtyDataCharsBySession.delete(sessionId)

    const data = chunks.length === 1 ? (chunks[0] ?? '') : chunks.join('')
    if (data.length === 0) {
      return
    }

    if (this.activeSessions.has(sessionId)) {
      const snapshot = this.snapshots.get(sessionId)
      if (snapshot) {
        appendSnapshotData(snapshot, data)
      }
    }

    if (!this.hasPtyDataSubscribers(sessionId)) {
      return
    }

    const eventPayload: TerminalDataEvent = { sessionId, data }
    this.sendPtyDataToSubscribers(eventPayload)
  }

  private queuePtyDataBroadcast(sessionId: string, data: string): void {
    if (data.length === 0) {
      return
    }

    const chunks = this.pendingPtyDataChunksBySession.get(sessionId) ?? []
    if (chunks.length === 0) {
      this.pendingPtyDataChunksBySession.set(sessionId, chunks)
    }

    chunks.push(data)
    const pendingChars = (this.pendingPtyDataCharsBySession.get(sessionId) ?? 0) + data.length
    this.pendingPtyDataCharsBySession.set(sessionId, pendingChars)

    if (pendingChars >= PTY_DATA_MAX_BATCH_CHARS) {
      this.flushPtyDataBroadcast(sessionId)
      return
    }

    const nextDelayMs = this.resolvePtyDataFlushDelay(pendingChars)
    const existingTimer = this.pendingPtyDataFlushTimerBySession.get(sessionId)
    const existingDelayMs = this.pendingPtyDataFlushDelayBySession.get(sessionId)

    if (existingTimer && existingDelayMs !== undefined) {
      if (existingDelayMs >= nextDelayMs) {
        return
      }

      clearTimeout(existingTimer)
      this.pendingPtyDataFlushTimerBySession.delete(sessionId)
    }

    this.pendingPtyDataFlushDelayBySession.set(sessionId, nextDelayMs)
    this.pendingPtyDataFlushTimerBySession.set(
      sessionId,
      setTimeout(() => {
        this.flushPtyDataBroadcast(sessionId)
      }, nextDelayMs),
    )
  }

  // --- Public API ---

  handleData(sessionId: string, data: string): void {
    if (!this.terminatedSessions.has(sessionId)) {
      this.activeSessions.add(sessionId)
      if (!this.snapshots.has(sessionId)) {
        this.snapshots.set(sessionId, createEmptySnapshotState())
      }
    }

    this.queuePtyDataBroadcast(sessionId, data)
  }

  handleExit(sessionId: string, exitCode: number): void {
    this.flushPtyDataBroadcast(sessionId)
    this.sessionStateWatcher.disposeSession(sessionId)
    this.cleanupSessionPtyDataSubscriptions(sessionId)
    this.activeSessions.delete(sessionId)
    this.terminatedSessions.add(sessionId)
    const eventPayload: TerminalExitEvent = { sessionId, exitCode }
    this.sendToAllWindows(IPC_CHANNELS.ptyExit, eventPayload)
  }

  registerSession(sessionId: string): void {
    this.activeSessions.add(sessionId)
    this.terminatedSessions.delete(sessionId)
    if (!this.snapshots.has(sessionId)) {
      this.snapshots.set(sessionId, createEmptySnapshotState())
    }
  }

  attach(contentsId: number, sessionId: string): void {
    this.trackWebContentsSubscriptionLifecycle(contentsId)

    const sessions = this.ptyDataSessionsByWebContentsId.get(contentsId) ?? new Set<string>()
    sessions.add(sessionId)
    this.ptyDataSessionsByWebContentsId.set(contentsId, sessions)

    const subscribers = this.ptyDataSubscribersBySessionId.get(sessionId) ?? new Set<number>()
    subscribers.add(contentsId)
    this.ptyDataSubscribersBySessionId.set(sessionId, subscribers)

    this.onProbeSubscriptionChanged(sessionId)
    this.flushPtyDataBroadcast(sessionId)
  }

  detach(contentsId: number, sessionId: string): void {
    const sessions = this.ptyDataSessionsByWebContentsId.get(contentsId)
    sessions?.delete(sessionId)
    if (sessions && sessions.size === 0) {
      this.ptyDataSessionsByWebContentsId.delete(contentsId)
    }

    const subscribers = this.ptyDataSubscribersBySessionId.get(sessionId)
    subscribers?.delete(contentsId)
    if (subscribers && subscribers.size === 0) {
      this.ptyDataSubscribersBySessionId.delete(sessionId)
    }

    this.onProbeSubscriptionChanged(sessionId)
  }

  snapshot(sessionId: string): string {
    this.flushPtyDataBroadcast(sessionId)
    const snapshot = this.snapshots.get(sessionId)
    if (!snapshot) {
      throw new Error(`Unknown terminal session: ${sessionId}`)
    }

    return snapshotToString(snapshot)
  }

  kill(sessionId: string): void {
    this.flushPtyDataBroadcast(sessionId)
    this.sessionStateWatcher.disposeSession(sessionId)
    this.cleanupSessionPtyDataSubscriptions(sessionId)
    this.activeSessions.delete(sessionId)
    this.terminatedSessions.add(sessionId)
    this.snapshots.delete(sessionId)
  }

  startSessionStateWatcher(input: SessionStateWatcherStartInput): void {
    this.sessionStateWatcher.start(input)
  }

  dispose(): void {
    this.sessionStateWatcher.dispose()

    this.pendingPtyDataFlushTimerBySession.forEach(timer => {
      clearTimeout(timer)
    })
    this.pendingPtyDataFlushTimerBySession.clear()
    this.pendingPtyDataFlushDelayBySession.clear()
    this.pendingPtyDataChunksBySession.clear()
    this.pendingPtyDataCharsBySession.clear()
    this.ptyDataSubscribersBySessionId.clear()
    this.ptyDataSessionsByWebContentsId.clear()
    this.ptyDataSubscribedWebContentsIds.clear()

    this.activeSessions.clear()
    this.terminatedSessions.clear()
    this.snapshots.clear()
  }
}
