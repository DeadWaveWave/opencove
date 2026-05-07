import type { Terminal } from '@xterm/xterm'
import { cancelTerminalOutputDrain, scheduleTerminalOutputDrain } from './terminalOutputFrameBudget'

export interface TerminalOutputScheduler {
  handleChunk: (
    data: string,
    options?: {
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

  const pendingWrites: string[] = []
  let pendingWritesHead = 0
  let pendingWriteChars = 0
  let pendingDrainHandle: number | null = null
  let pendingDrainRequest: DrainRequest | null = null
  let viewportFlushTimer: number | null = null

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

  const enqueue = (data: string): void => {
    pendingWrites.push(data)
    pendingWriteChars += data.length
  }

  const takeChunk = (maxChars: number): string => {
    let remaining = maxChars
    const parts: string[] = []

    while (remaining > 0 && pendingWritesHead < pendingWrites.length) {
      const next = pendingWrites[pendingWritesHead] ?? ''
      if (next.length <= remaining) {
        parts.push(next)
        pendingWriteChars -= next.length
        pendingWritesHead += 1
        remaining -= next.length
        continue
      }

      parts.push(next.slice(0, remaining))
      pendingWrites[pendingWritesHead] = next.slice(remaining)
      pendingWriteChars -= remaining
      remaining = 0
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

  const flush = ({
    allowDuringViewportInteraction = false,
    budgetChars,
    force = false,
  }: DrainRequest = {}): void => {
    if (isDisposed || !hasPending()) {
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
    const chunk = takeChunk(Math.min(maxChunkSize, resolvedBudget))
    if (chunk.length === 0) {
      isDraining = false
      return
    }

    hasWriteInFlight = true
    terminal.write(chunk, () => {
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

    enqueue(data)

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
      hasPending() || isDraining || hasWriteInFlight || pendingDrainHandle !== null,
    dispose: () => {
      isDisposed = true
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
