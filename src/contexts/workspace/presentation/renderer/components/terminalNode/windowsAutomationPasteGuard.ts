type PtyWriteEncoding = 'utf8' | 'binary'

type PtyWriteQueue = {
  enqueue: (data: string, encoding?: PtyWriteEncoding) => void
  flush: () => void
}

export type WindowsAutomationPasteGuard = {
  cancelPendingInterrupt: () => boolean
  dispose: () => void
  noteColumnSelectionMode: (active: boolean, clearSelection: () => void) => void
  noteKeyboardEvent: (event: {
    type: string
    key: string
    code?: string | null
    repeat?: boolean
  }) => void
  noteManualPointerInteraction: () => void
  noteSelectionChange: (hasSelection: boolean, clearSelection: () => void) => void
  scheduleInterrupt: () => void
  shouldSuppressSelectionCopy: () => boolean
}

export function createWindowsAutomationPasteGuard({
  delayMs = 700,
  modifierStormDelayMs = 1800,
  modifierStormRepeatThreshold = 3,
  modifierStormWindowMs = 800,
  pointerGraceMs = 1200,
  selectionWindowMs = 30000,
  ptyWriteQueue,
}: {
  delayMs?: number
  modifierStormDelayMs?: number
  modifierStormRepeatThreshold?: number
  modifierStormWindowMs?: number
  pointerGraceMs?: number
  ptyWriteQueue: PtyWriteQueue
  selectionWindowMs?: number
}): WindowsAutomationPasteGuard {
  let lastAutomationPasteAt: number | null = null
  let lastManualPointerAt = 0
  let suspiciousSelectionUntil = 0
  let pendingInterruptTimer: ReturnType<typeof setTimeout> | null = null
  let repeatedHotkeyStorm: {
    signature: string
    count: number
    lastAt: number
  } | null = null

  const isWithinAutomationSelectionWindow = (now: number): boolean => {
    return lastAutomationPasteAt !== null && now - lastAutomationPasteAt <= selectionWindowMs
  }

  const hasRecentRepeatedHotkeyStorm = (now: number): boolean => {
    return (
      repeatedHotkeyStorm !== null &&
      repeatedHotkeyStorm.count >= modifierStormRepeatThreshold &&
      now - repeatedHotkeyStorm.lastAt <= modifierStormWindowMs
    )
  }

  const markSuspiciousSelection = (now: number, clearSelection: () => void): void => {
    suspiciousSelectionUntil = Math.max(suspiciousSelectionUntil, now + selectionWindowMs)
    clearSelection()
  }

  const cancelPendingInterrupt = (): boolean => {
    if (pendingInterruptTimer === null) {
      return false
    }

    clearTimeout(pendingInterruptTimer)
    pendingInterruptTimer = null
    lastAutomationPasteAt = Date.now()
    return true
  }

  return {
    cancelPendingInterrupt,
    dispose: () => {
      cancelPendingInterrupt()
      lastAutomationPasteAt = null
      repeatedHotkeyStorm = null
      suspiciousSelectionUntil = 0
    },
    noteColumnSelectionMode: (active, clearSelection) => {
      if (!active) {
        return
      }

      const now = Date.now()
      if (!isWithinAutomationSelectionWindow(now)) {
        return
      }

      if (now - lastManualPointerAt <= pointerGraceMs) {
        return
      }

      markSuspiciousSelection(now, clearSelection)
    },
    noteKeyboardEvent: event => {
      const now = Date.now()
      const signature = `${event.key}::${event.code ?? ''}`

      if (event.type === 'keyup') {
        return
      }

      if (event.type !== 'keydown' || event.repeat !== true) {
        return
      }

      if (
        repeatedHotkeyStorm !== null &&
        repeatedHotkeyStorm.signature === signature &&
        now - repeatedHotkeyStorm.lastAt <= modifierStormWindowMs
      ) {
        repeatedHotkeyStorm = {
          signature,
          count: repeatedHotkeyStorm.count + 1,
          lastAt: now,
        }
        return
      }

      repeatedHotkeyStorm = {
        signature,
        count: 1,
        lastAt: now,
      }
    },
    noteManualPointerInteraction: () => {
      lastManualPointerAt = Date.now()
      suspiciousSelectionUntil = 0
    },
    noteSelectionChange: (hasSelection, clearSelection) => {
      if (!hasSelection || lastAutomationPasteAt === null) {
        return
      }

      const now = Date.now()
      if (!isWithinAutomationSelectionWindow(now)) {
        lastAutomationPasteAt = null
        return
      }

      if (now - lastManualPointerAt <= pointerGraceMs) {
        return
      }

      markSuspiciousSelection(now, clearSelection)
    },
    scheduleInterrupt: () => {
      if (pendingInterruptTimer !== null) {
        clearTimeout(pendingInterruptTimer)
      }

      const effectiveDelayMs = hasRecentRepeatedHotkeyStorm(Date.now())
        ? modifierStormDelayMs
        : delayMs

      pendingInterruptTimer = setTimeout(() => {
        pendingInterruptTimer = null
        ptyWriteQueue.enqueue('\u0003')
        ptyWriteQueue.flush()
      }, effectiveDelayMs)
    },
    shouldSuppressSelectionCopy: () => {
      const now = Date.now()
      if (suspiciousSelectionUntil > now) {
        if (now - lastManualPointerAt <= pointerGraceMs) {
          suspiciousSelectionUntil = 0
          return false
        }

        return true
      }

      if (lastAutomationPasteAt === null) {
        return false
      }

      if (!isWithinAutomationSelectionWindow(now)) {
        lastAutomationPasteAt = null
        return false
      }

      if (now - lastManualPointerAt <= pointerGraceMs) {
        return false
      }

      return true
    },
  }
}
