import type { Terminal } from '@xterm/xterm'

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
  options,
}: {
  terminal: Terminal
  scrollbackBuffer: ScrollbackBuffer
  markScrollbackDirty: (immediate?: boolean) => void
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
  let pendingWriteFrame: number | null = null
  let viewportFlushTimer: number | null = null

  let isDisposed = false
  let isDraining = false
  let isViewportInteractionActive = false

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
      flush({
        allowDuringViewportInteraction: true,
        budgetChars: viewportInteractionWriteChunkChars,
      })
    }, viewportInteractionFlushDelayMs)
  }

  const flush = ({
    allowDuringViewportInteraction = false,
    budgetChars,
    force = false,
  }: {
    allowDuringViewportInteraction?: boolean
    budgetChars?: number
    force?: boolean
  } = {}): void => {
    if (isDisposed || isDraining || !hasPending()) {
      return
    }

    const canDrainDuringViewportInteraction = allowDuringViewportInteraction || force
    const shouldBlock = isViewportInteractionActive && !canDrainDuringViewportInteraction
    if (shouldBlock) {
      return
    }

    isDraining = true
    let remainingBudget =
      typeof budgetChars === 'number' && Number.isFinite(budgetChars)
        ? Math.max(0, budgetChars)
        : Number.POSITIVE_INFINITY

    const drainStep = () => {
      if (isDisposed) {
        isDraining = false
        return
      }

      const isInteracting = isViewportInteractionActive
      if (isInteracting && !canDrainDuringViewportInteraction) {
        isDraining = false
        scheduleViewportFlush()
        return
      }

      if (!hasPending()) {
        isDraining = false
        return
      }

      if (remainingBudget <= 0) {
        isDraining = false

        if (isViewportInteractionActive && allowDuringViewportInteraction && hasPending()) {
          scheduleViewportFlush()
        } else if (!isViewportInteractionActive && hasPending()) {
          pendingWriteFrame = window.requestAnimationFrame(() => {
            pendingWriteFrame = null
            flush()
          })
        }

        return
      }

      const maxChunkSize = isInteracting
        ? viewportInteractionWriteChunkChars
        : normalWriteChunkChars
      const chunk = takeChunk(Math.min(maxChunkSize, remainingBudget))
      if (chunk.length === 0) {
        isDraining = false
        return
      }

      remainingBudget -= chunk.length
      terminal.write(chunk, () => {
        pendingWriteFrame = window.requestAnimationFrame(() => {
          pendingWriteFrame = null
          drainStep()
        })
      })
    }

    drainStep()
  }

  const handleChunk: TerminalOutputScheduler['handleChunk'] = (data, chunkOptions) => {
    if (data.length === 0 || isDisposed) {
      return
    }

    scrollbackBuffer.append(data)
    markScrollbackDirty(chunkOptions?.immediateScrollbackPublish === true)

    const shouldDeferWrite = isViewportInteractionActive || isDraining || hasPending()

    if (shouldDeferWrite) {
      enqueue(data)

      if (isViewportInteractionActive) {
        if (pendingWriteChars >= maxPendingChars) {
          flush({ force: true })
        } else {
          scheduleViewportFlush()
        }
        return
      }

      flush()
      return
    }

    terminal.write(data)
  }

  const onViewportInteractionActiveChange = (isActive: boolean) => {
    if (isDisposed) {
      return
    }

    isViewportInteractionActive = isActive
    if (!isActive) {
      cancelViewportFlushTimer()
      flush()
    }
  }

  return {
    handleChunk,
    onViewportInteractionActiveChange,
    hasPendingWrites: () => hasPending() || isDraining,
    dispose: () => {
      isDisposed = true
      cancelViewportFlushTimer()
      if (pendingWriteFrame !== null) {
        window.cancelAnimationFrame(pendingWriteFrame)
        pendingWriteFrame = null
      }
      pendingWrites.length = 0
      pendingWritesHead = 0
      pendingWriteChars = 0
      isDraining = false
    },
  }
}
