import type {
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalGeometryEvent,
  TerminalResyncEvent,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '@shared/contracts/dto'

type UnsubscribeFn = () => void

interface PtyEventSource {
  onData: (listener: (event: TerminalDataEvent) => void) => UnsubscribeFn
  onExit: (listener: (event: TerminalExitEvent) => void) => UnsubscribeFn
  onGeometry?: (listener: (event: TerminalGeometryEvent) => void) => UnsubscribeFn
  onResync?: (listener: (event: TerminalResyncEvent) => void) => UnsubscribeFn
  onState?: (listener: (event: TerminalSessionStateEvent) => void) => UnsubscribeFn
  onMetadata?: (listener: (event: TerminalSessionMetadataEvent) => void) => UnsubscribeFn
}

type ListenerMap<Event> = {
  global: Set<(event: Event) => void>
  bySessionId: Map<string, Set<(event: Event) => void>>
}

export interface PtyEventHub {
  onData: (listener: (event: TerminalDataEvent) => void) => UnsubscribeFn
  onSessionData: (sessionId: string, listener: (event: TerminalDataEvent) => void) => UnsubscribeFn
  onExit: (listener: (event: TerminalExitEvent) => void) => UnsubscribeFn
  onSessionExit: (sessionId: string, listener: (event: TerminalExitEvent) => void) => UnsubscribeFn
  onGeometry: (listener: (event: TerminalGeometryEvent) => void) => UnsubscribeFn
  onSessionGeometry: (
    sessionId: string,
    listener: (event: TerminalGeometryEvent) => void,
  ) => UnsubscribeFn
  onResync: (listener: (event: TerminalResyncEvent) => void) => UnsubscribeFn
  onSessionResync: (
    sessionId: string,
    listener: (event: TerminalResyncEvent) => void,
  ) => UnsubscribeFn
  onState: (listener: (event: TerminalSessionStateEvent) => void) => UnsubscribeFn
  onSessionState: (
    sessionId: string,
    listener: (event: TerminalSessionStateEvent) => void,
  ) => UnsubscribeFn
  onMetadata: (listener: (event: TerminalSessionMetadataEvent) => void) => UnsubscribeFn
  onSessionMetadata: (
    sessionId: string,
    listener: (event: TerminalSessionMetadataEvent) => void,
  ) => UnsubscribeFn
  dispose: () => void
}

function createListenerMap<Event>(): ListenerMap<Event> {
  return {
    global: new Set(),
    bySessionId: new Map(),
  }
}

function dispatchEvent<Event extends { sessionId: string }>(
  listeners: ListenerMap<Event>,
  event: Event,
): void {
  listeners.global.forEach(listener => {
    listener(event)
  })

  const sessionListeners = listeners.bySessionId.get(event.sessionId)
  sessionListeners?.forEach(listener => {
    listener(event)
  })
}

function hasListeners<Event>(listeners: ListenerMap<Event>): boolean {
  return listeners.global.size > 0 || listeners.bySessionId.size > 0
}

function subscribeGlobal<Event>(
  listeners: ListenerMap<Event>,
  listener: (event: Event) => void,
): UnsubscribeFn {
  listeners.global.add(listener)
  return () => {
    listeners.global.delete(listener)
  }
}

function subscribeSession<Event>(
  listeners: ListenerMap<Event>,
  sessionId: string,
  listener: (event: Event) => void,
): UnsubscribeFn {
  const normalizedSessionId = sessionId.trim()
  if (normalizedSessionId.length === 0) {
    return () => undefined
  }

  const sessionListeners = listeners.bySessionId.get(normalizedSessionId) ?? new Set()
  sessionListeners.add(listener)
  listeners.bySessionId.set(normalizedSessionId, sessionListeners)

  return () => {
    const current = listeners.bySessionId.get(normalizedSessionId)
    if (!current) {
      return
    }

    current.delete(listener)
    if (current.size === 0) {
      listeners.bySessionId.delete(normalizedSessionId)
    }
  }
}

export function createPtyEventHub(source: PtyEventSource): PtyEventHub {
  const dataListeners = createListenerMap<TerminalDataEvent>()
  const exitListeners = createListenerMap<TerminalExitEvent>()
  const geometryListeners = createListenerMap<TerminalGeometryEvent>()
  const resyncListeners = createListenerMap<TerminalResyncEvent>()
  const stateListeners = createListenerMap<TerminalSessionStateEvent>()
  const metadataListeners = createListenerMap<TerminalSessionMetadataEvent>()
  const latestStateBySessionId = new Map<string, TerminalSessionStateEvent>()
  const latestMetadataBySessionId = new Map<string, TerminalSessionMetadataEvent>()

  let unsubscribeDataSource: UnsubscribeFn | null = null
  let unsubscribeExitSource: UnsubscribeFn | null = null
  let unsubscribeGeometrySource: UnsubscribeFn | null = null
  let unsubscribeResyncSource: UnsubscribeFn | null = null
  let unsubscribeStateSource: UnsubscribeFn | null = null
  let unsubscribeMetadataSource: UnsubscribeFn | null = null

  const ensureDataSourceSubscription = (): void => {
    if (unsubscribeDataSource || !hasListeners(dataListeners)) {
      return
    }

    unsubscribeDataSource = source.onData(event => {
      dispatchEvent(dataListeners, event)
    })
  }

  const ensureExitSourceSubscription = (): void => {
    if (unsubscribeExitSource || !hasListeners(exitListeners)) {
      return
    }

    unsubscribeExitSource = source.onExit(event => {
      dispatchEvent(exitListeners, event)
    })
  }

  const ensureGeometrySourceSubscription = (): void => {
    if (unsubscribeGeometrySource || !hasListeners(geometryListeners) || !source.onGeometry) {
      return
    }

    unsubscribeGeometrySource = source.onGeometry(event => {
      dispatchEvent(geometryListeners, event)
    })
  }

  const ensureResyncSourceSubscription = (): void => {
    if (unsubscribeResyncSource || !hasListeners(resyncListeners) || !source.onResync) {
      return
    }

    unsubscribeResyncSource = source.onResync(event => {
      dispatchEvent(resyncListeners, event)
    })
  }

  const ensureStateSourceSubscription = (): void => {
    if (unsubscribeStateSource || !hasListeners(stateListeners) || !source.onState) {
      return
    }

    unsubscribeStateSource = source.onState(event => {
      latestStateBySessionId.set(event.sessionId, event)
      dispatchEvent(stateListeners, event)
    })
  }

  const ensureMetadataSourceSubscription = (): void => {
    if (unsubscribeMetadataSource || !hasListeners(metadataListeners) || !source.onMetadata) {
      return
    }

    unsubscribeMetadataSource = source.onMetadata(event => {
      latestMetadataBySessionId.set(event.sessionId, event)
      dispatchEvent(metadataListeners, event)
    })
  }

  const cleanupDataSourceSubscription = (): void => {
    if (unsubscribeDataSource && !hasListeners(dataListeners)) {
      unsubscribeDataSource()
      unsubscribeDataSource = null
    }
  }

  const cleanupExitSourceSubscription = (): void => {
    if (unsubscribeExitSource && !hasListeners(exitListeners)) {
      unsubscribeExitSource()
      unsubscribeExitSource = null
    }
  }

  const cleanupGeometrySourceSubscription = (): void => {
    if (unsubscribeGeometrySource && !hasListeners(geometryListeners)) {
      unsubscribeGeometrySource()
      unsubscribeGeometrySource = null
    }
  }

  const cleanupResyncSourceSubscription = (): void => {
    if (unsubscribeResyncSource && !hasListeners(resyncListeners)) {
      unsubscribeResyncSource()
      unsubscribeResyncSource = null
    }
  }

  const cleanupStateSourceSubscription = (): void => {
    if (unsubscribeStateSource && !hasListeners(stateListeners)) {
      unsubscribeStateSource()
      unsubscribeStateSource = null
    }
  }

  const cleanupMetadataSourceSubscription = (): void => {
    if (unsubscribeMetadataSource && !hasListeners(metadataListeners)) {
      unsubscribeMetadataSource()
      unsubscribeMetadataSource = null
    }
  }

  const onData = (listener: (event: TerminalDataEvent) => void): UnsubscribeFn => {
    const unsubscribe = subscribeGlobal(dataListeners, listener)
    ensureDataSourceSubscription()
    return () => {
      unsubscribe()
      cleanupDataSourceSubscription()
    }
  }

  const onSessionData = (
    sessionId: string,
    listener: (event: TerminalDataEvent) => void,
  ): UnsubscribeFn => {
    const unsubscribe = subscribeSession(dataListeners, sessionId, listener)
    ensureDataSourceSubscription()
    return () => {
      unsubscribe()
      cleanupDataSourceSubscription()
    }
  }

  const onExit = (listener: (event: TerminalExitEvent) => void): UnsubscribeFn => {
    const unsubscribe = subscribeGlobal(exitListeners, listener)
    ensureExitSourceSubscription()
    return () => {
      unsubscribe()
      cleanupExitSourceSubscription()
    }
  }

  const onSessionExit = (
    sessionId: string,
    listener: (event: TerminalExitEvent) => void,
  ): UnsubscribeFn => {
    const unsubscribe = subscribeSession(exitListeners, sessionId, listener)
    ensureExitSourceSubscription()
    return () => {
      unsubscribe()
      cleanupExitSourceSubscription()
    }
  }

  const onGeometry = (listener: (event: TerminalGeometryEvent) => void): UnsubscribeFn => {
    const unsubscribe = subscribeGlobal(geometryListeners, listener)
    ensureGeometrySourceSubscription()
    return () => {
      unsubscribe()
      cleanupGeometrySourceSubscription()
    }
  }

  const onSessionGeometry = (
    sessionId: string,
    listener: (event: TerminalGeometryEvent) => void,
  ): UnsubscribeFn => {
    const unsubscribe = subscribeSession(geometryListeners, sessionId, listener)
    ensureGeometrySourceSubscription()
    return () => {
      unsubscribe()
      cleanupGeometrySourceSubscription()
    }
  }

  const onResync = (listener: (event: TerminalResyncEvent) => void): UnsubscribeFn => {
    const unsubscribe = subscribeGlobal(resyncListeners, listener)
    ensureResyncSourceSubscription()
    return () => {
      unsubscribe()
      cleanupResyncSourceSubscription()
    }
  }

  const onSessionResync = (
    sessionId: string,
    listener: (event: TerminalResyncEvent) => void,
  ): UnsubscribeFn => {
    const unsubscribe = subscribeSession(resyncListeners, sessionId, listener)
    ensureResyncSourceSubscription()
    return () => {
      unsubscribe()
      cleanupResyncSourceSubscription()
    }
  }

  const onState = (listener: (event: TerminalSessionStateEvent) => void): UnsubscribeFn => {
    const unsubscribe = subscribeGlobal(stateListeners, listener)
    ensureStateSourceSubscription()
    latestStateBySessionId.forEach(event => {
      listener(event)
    })
    return () => {
      unsubscribe()
      cleanupStateSourceSubscription()
    }
  }

  const onSessionState = (
    sessionId: string,
    listener: (event: TerminalSessionStateEvent) => void,
  ): UnsubscribeFn => {
    const unsubscribe = subscribeSession(stateListeners, sessionId, listener)
    ensureStateSourceSubscription()
    const cached = latestStateBySessionId.get(sessionId)
    if (cached) {
      listener(cached)
    }
    return () => {
      unsubscribe()
      cleanupStateSourceSubscription()
    }
  }

  const onMetadata = (listener: (event: TerminalSessionMetadataEvent) => void): UnsubscribeFn => {
    const unsubscribe = subscribeGlobal(metadataListeners, listener)
    ensureMetadataSourceSubscription()
    latestMetadataBySessionId.forEach(event => {
      listener(event)
    })
    return () => {
      unsubscribe()
      cleanupMetadataSourceSubscription()
    }
  }

  const onSessionMetadata = (
    sessionId: string,
    listener: (event: TerminalSessionMetadataEvent) => void,
  ): UnsubscribeFn => {
    const unsubscribe = subscribeSession(metadataListeners, sessionId, listener)
    ensureMetadataSourceSubscription()
    const cached = latestMetadataBySessionId.get(sessionId)
    if (cached) {
      listener(cached)
    }
    return () => {
      unsubscribe()
      cleanupMetadataSourceSubscription()
    }
  }

  return {
    onData,
    onSessionData,
    onExit,
    onSessionExit,
    onGeometry,
    onSessionGeometry,
    onResync,
    onSessionResync,
    onState,
    onSessionState,
    onMetadata,
    onSessionMetadata,
    dispose: () => {
      unsubscribeDataSource?.()
      unsubscribeExitSource?.()
      unsubscribeGeometrySource?.()
      unsubscribeResyncSource?.()
      unsubscribeStateSource?.()
      unsubscribeMetadataSource?.()
      unsubscribeDataSource = null
      unsubscribeExitSource = null
      unsubscribeGeometrySource = null
      unsubscribeResyncSource = null
      unsubscribeStateSource = null
      unsubscribeMetadataSource = null
      dataListeners.global.clear()
      dataListeners.bySessionId.clear()
      exitListeners.global.clear()
      exitListeners.bySessionId.clear()
      stateListeners.global.clear()
      stateListeners.bySessionId.clear()
      metadataListeners.global.clear()
      metadataListeners.bySessionId.clear()
      latestStateBySessionId.clear()
      latestMetadataBySessionId.clear()
    },
  }
}

let singleton: {
  source: PtyEventSource
  hub: PtyEventHub
} | null = null

export function getPtyEventHub(): PtyEventHub {
  const source = window.opencoveApi.pty
  if (!singleton || singleton.source !== source) {
    singleton?.hub.dispose()
    singleton = {
      source,
      hub: createPtyEventHub(source),
    }
  }

  return singleton.hub
}
