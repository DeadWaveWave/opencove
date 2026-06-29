import type { Terminal } from '@xterm/xterm'
import { cancelTerminalOutputDrain, scheduleTerminalOutputDrain } from './terminalOutputFrameBudget'
import {
  captureTerminalScrollState,
  restoreTerminalScrollStateAfterRedraw,
} from './effectiveDevicePixelRatio'
import {
  canWriteTerminalOutput,
  subscribeTerminalGeometryWriteGate,
} from './terminalGeometryCoordinator'

export interface TerminalOutputScheduler {
  handleChunk: (
    data: string,
    options?: {
      allowDuringPendingGeometry?: boolean
      immediateScrollbackPublish?: boolean
    },
  ) => void
  onViewportInteractionActiveChange: (isActive: boolean) => void
  hasPendingWrites: () => boolean
  dispose: () => void
}

type ScrollbackBuffer = {
  append: (data: string) => void
}

type PendingTerminalWrite = {
  allowDuringPendingGeometry: boolean
  data: string
}

export function createTerminalOutputScheduler({
  terminal,
  scrollbackBuffer,
  markScrollbackDirty,
  onWriteCommitted,
  options,
}: {
  terminal: Terminal
  scrollbackBuffer: ScrollbackBuffer
  markScrollbackDirty: (immediate?: boolean) => void
  onWriteCommitted?: (data: string) => void
  options?: Partial<{
    maxPendingChars: number
    normalWriteChunkChars: number
    viewportInteractionWriteChunkChars: number
    viewportInteractionFlushDelayMs: number
  }>
}): TerminalOutputScheduler {
  const maxPendingChars = options?.maxPendingChars ?? 1_000_000
  const normalWriteChunkChars = options?.normalWriteChunkChars ?? 64_000
  const viewportInteractionWriteChunkChars = options?.viewportInteractionWriteChunkChars ?? 8_000
  const viewportInteractionFlushDelayMs = options?.viewportInteractionFlushDelayMs ?? 300

  const pendingWrites: PendingTerminalWrite[] = []
  let pendingWritesHead = 0
  let pendingWriteChars = 0
  let pendingDrainHandle: number | null = null
  let pendingDrainRequest: DrainRequest | null = null
  let viewportFlushTimer: number | null = null
  let unsubscribeGeometryWriteGate: (() => void) | null = null

  let isDisposed = false
  let isDraining = false
  let isViewportInteractionActive = false
  let hasWriteInFlight = false

  type DrainRequest = {
    allowDuringViewportInteraction?: boolean
    budgetChars?: number
    force?: boolean
  }

  const hasPending = (): boolean => {
    return pendingWritesHead < pendingWrites.length
  }

  const cleanupPendingWrites = (): void => {
    if (pendingWritesHead <= 64) {
      return
    }

    pendingWrites.splice(0, pendingWritesHead)
    pendingWritesHead = 0
  }

  const enqueue = (data: string, writeOptions?: { allowDuringPendingGeometry?: boolean }): void => {
    pendingWrites.push({
      allowDuringPendingGeometry: writeOptions?.allowDuringPendingGeometry === true,
      data,
    })
    pendingWriteChars += data.length
  }

  const hasPendingGeometryBypassWrite = (): boolean =>
    pendingWrites[pendingWritesHead]?.allowDuringPendingGeometry === true

  const takeNextPendingWriteIndex = (allowOnlyGeometryBypassWrites: boolean): number => {
    if (!allowOnlyGeometryBypassWrites) {
      return pendingWritesHead
    }

    return pendingWrites[pendingWritesHead]?.allowDuringPendingGeometry === true
      ? pendingWritesHead
      : -1
  }

  const consumePendingWriteAt = (index: number, remaining: number): string => {
    const next = pendingWrites[index]
    if (!next) {
      return ''
    }

    if (next.data.length <= remaining) {
      const data = next.data
      pendingWriteChars -= data.length
      if (index === pendingWritesHead) {
        pendingWritesHead += 1
      } else {
        pendingWrites.splice(index, 1)
      }
      return data
    }

    const data = next.data.slice(0, remaining)
    next.data = next.data.slice(remaining)
    pendingWriteChars -= data.length
    return data
  }

  const takeChunk = (
    maxChars: number,
    takeOptions?: { allowOnlyGeometryBypassWrites?: boolean },
  ): string => {
    let remaining = maxChars
    const parts: string[] = []

    while (remaining > 0) {
      const nextIndex = takeNextPendingWriteIndex(
        takeOptions?.allowOnlyGeometryBypassWrites === true,
      )
      if (nextIndex < pendingWritesHead || nextIndex >= pendingWrites.length) {
        break
      }

      const consumed = consumePendingWriteAt(nextIndex, remaining)
      if (consumed.length === 0) {
        break
      }

      parts.push(consumed)
      remaining -= consumed.length
    }

    cleanupPendingWrites()
    return parts.length === 1 ? (parts[0] ?? '') : parts.join('')
  }

  const cancelViewportFlushTimer = (): void => {
    if (viewportFlushTimer === null) {
      return
    }

    window.clearTimeout(viewportFlushTimer)
    viewportFlushTimer = null
  }

  const scheduleViewportFlush = (): void => {
    if (isDisposed || viewportFlushTimer !== null) {
      return
    }

    viewportFlushTimer = window.setTimeout(() => {
      viewportFlushTimer = null
      scheduleDrain({
        allowDuringViewportInteraction: true,
        budgetChars: viewportInteractionWriteChunkChars,
      })
    }, viewportInteractionFlushDelayMs)
  }

  const mergeDrainRequest = (next: DrainRequest): void => {
    const current = pendingDrainRequest ?? {}
    pendingDrainRequest = {
      allowDuringViewportInteraction:
        current.allowDuringViewportInteraction === true ||
        next.allowDuringViewportInteraction === true,
      force: current.force === true || next.force === true,
      budgetChars:
        typeof current.budgetChars === 'number' && typeof next.budgetChars === 'number'
          ? Math.max(current.budgetChars, next.budgetChars)
          : (current.budgetChars ?? next.budgetChars),
    }
  }

  const scheduleDrain = (request: DrainRequest = {}): void => {
    if (isDisposed) {
      return
    }

    mergeDrainRequest(request)
    if (pendingDrainHandle !== null) {
      return
    }

    pendingDrainHandle = scheduleTerminalOutputDrain(() => {
      pendingDrainHandle = null
      const nextRequest = pendingDrainRequest ?? {}
      pendingDrainRequest = null
      flush(nextRequest)
    })
  }

  const waitForGeometryWriteGate = (request: DrainRequest): void => {
    mergeDrainRequest(request)
    if (unsubscribeGeometryWriteGate !== null) {
      return
    }

    unsubscribeGeometryWriteGate = subscribeTerminalGeometryWriteGate(terminal, () => {
      const unsubscribe = unsubscribeGeometryWriteGate
      unsubscribeGeometryWriteGate = null
      unsubscribe?.()
      scheduleDrain()
    })
  }

  const flush = ({
    allowDuringViewportInteraction = false,
    budgetChars,
    force = false,
  }: DrainRequest = {}): void => {
    if (isDisposed || !hasPending()) {
      return
    }

    const canWriteThroughGeometryGate = canWriteTerminalOutput(terminal)
    if (!canWriteThroughGeometryGate && !hasPendingGeometryBypassWrite()) {
      waitForGeometryWriteGate({ allowDuringViewportInteraction, budgetChars, force })
      return
    }

    if (isDraining || hasWriteInFlight) {
      mergeDrainRequest({ allowDuringViewportInteraction, budgetChars, force })
      return
    }

    const canDrainDuringViewportInteraction = allowDuringViewportInteraction || force
    const shouldBlock = isViewportInteractionActive && !canDrainDuringViewportInteraction
    if (shouldBlock) {
      scheduleViewportFlush()
      return
    }

    const resolvedBudget =
      typeof budgetChars === 'number' && Number.isFinite(budgetChars)
        ? Math.max(0, budgetChars)
        : Number.POSITIVE_INFINITY
    if (resolvedBudget <= 0) {
      return
    }

    isDraining = true
    const maxChunkSize = isViewportInteractionActive
      ? viewportInteractionWriteChunkChars
      : normalWriteChunkChars
    const chunk = takeChunk(Math.min(maxChunkSize, resolvedBudget), {
      allowOnlyGeometryBypassWrites: !canWriteThroughGeometryGate,
    })
    if (chunk.length === 0) {
      isDraining = false
      return
    }

    hasWriteInFlight = true
    const scrollState = captureTerminalScrollState(terminal)
    terminal.write(chunk, () => {
      restoreTerminalScrollStateAfterRedraw(terminal, scrollState)
      hasWriteInFlight = false
      isDraining = false
      onWriteCommitted?.(chunk)

      if (!hasPending()) {
        return
      }
      if (pendingDrainRequest !== null) {
        scheduleDrain()
        return
      }
      if (isViewportInteractionActive) {
        if (allowDuringViewportInteraction || force) {
          scheduleDrain({ allowDuringViewportInteraction: true, budgetChars, force })
        } else {
          scheduleViewportFlush()
        }
        return
      }
      scheduleDrain()
    })
  }

  const handleChunk: TerminalOutputScheduler['handleChunk'] = (data, chunkOptions) => {
    if (data.length === 0 || isDisposed) {
      return
    }

    scrollbackBuffer.append(data)
    markScrollbackDirty(chunkOptions?.immediateScrollbackPublish === true)

    enqueue(data, chunkOptions)

    if (isViewportInteractionActive) {
      if (pendingWriteChars >= maxPendingChars) {
        scheduleDrain({ force: true })
      } else {
        scheduleViewportFlush()
      }
      return
    }

    scheduleDrain()
  }

  const onViewportInteractionActiveChange = (isActive: boolean) => {
    if (isDisposed) {
      return
    }

    isViewportInteractionActive = isActive
    if (!isActive) {
      cancelViewportFlushTimer()
      scheduleDrain()
    }
  }

  return {
    handleChunk,
    onViewportInteractionActiveChange,
    hasPendingWrites: () =>
      hasPending() ||
      isDraining ||
      hasWriteInFlight ||
      pendingDrainHandle !== null ||
      unsubscribeGeometryWriteGate !== null,
    dispose: () => {
      isDisposed = true
      unsubscribeGeometryWriteGate?.()
      unsubscribeGeometryWriteGate = null
      cancelViewportFlushTimer()
      if (pendingDrainHandle !== null) {
        cancelTerminalOutputDrain(pendingDrainHandle)
        pendingDrainHandle = null
      }
      pendingWrites.length = 0
      pendingWritesHead = 0
      pendingWriteChars = 0
      pendingDrainRequest = null
      hasWriteInFlight = false
      isDraining = false
    },
  }
}
