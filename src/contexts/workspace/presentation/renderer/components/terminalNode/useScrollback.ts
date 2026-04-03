import { useCallback, useEffect, useRef } from 'react'
import { createRollingTextBuffer } from '../../utils/rollingTextBuffer'
import { MAX_SCROLLBACK_CHARS, SCROLLBACK_PUBLISH_DELAY_MS } from './constants'
import { truncateScrollback } from './scrollback'

export interface TerminalScrollbackController {
  scrollbackBufferRef: React.MutableRefObject<ReturnType<typeof createRollingTextBuffer>>
  markScrollbackDirty: (immediate?: boolean) => void
  scheduleScrollbackPublish: (immediate?: boolean) => void
  disposeScrollbackPublish: () => void
  cancelScrollbackPublish: () => void
}

export function useTerminalScrollback({
  sessionId,
  scrollback,
  onScrollbackChange,
  isPointerResizingRef,
}: {
  sessionId: string
  scrollback: string | null
  onScrollbackChange?: (scrollback: string) => void
  isPointerResizingRef: React.MutableRefObject<boolean>
}): TerminalScrollbackController {
  const publishTimerRef = useRef<number | null>(null)
  const scrollbackBufferRef = useRef(
    createRollingTextBuffer({
      maxChars: MAX_SCROLLBACK_CHARS,
      initial: truncateScrollback(scrollback ?? ''),
    }),
  )
  const publishedScrollbackRef = useRef(truncateScrollback(scrollback ?? ''))
  const hasPendingScrollbackRef = useRef(false)
  const onScrollbackChangeRef = useRef<typeof onScrollbackChange>(onScrollbackChange)

  useEffect(() => {
    const normalized = truncateScrollback(scrollback ?? '')
    scrollbackBufferRef.current.set(normalized)
    publishedScrollbackRef.current = normalized
    hasPendingScrollbackRef.current = false

    if (publishTimerRef.current !== null) {
      window.clearTimeout(publishTimerRef.current)
      publishTimerRef.current = null
    }
  }, [scrollback, sessionId])

  useEffect(() => {
    onScrollbackChangeRef.current = onScrollbackChange
  }, [onScrollbackChange])

  const flushScrollback = useCallback(() => {
    const onScrollbackChangeFn = onScrollbackChangeRef.current
    if (!onScrollbackChangeFn) {
      hasPendingScrollbackRef.current = false
      return
    }

    if (!hasPendingScrollbackRef.current) {
      return
    }

    hasPendingScrollbackRef.current = false
    const pending = scrollbackBufferRef.current.snapshot()
    if (pending === publishedScrollbackRef.current) {
      return
    }

    publishedScrollbackRef.current = pending
    onScrollbackChangeFn(pending)
  }, [])

  const scheduleScrollbackPublish = useCallback(
    (immediate = false) => {
      if (immediate) {
        if (publishTimerRef.current !== null) {
          window.clearTimeout(publishTimerRef.current)
          publishTimerRef.current = null
        }

        flushScrollback()
        return
      }

      if (publishTimerRef.current !== null) {
        return
      }

      publishTimerRef.current = window.setTimeout(() => {
        publishTimerRef.current = null
        flushScrollback()
      }, SCROLLBACK_PUBLISH_DELAY_MS)
    },
    [flushScrollback],
  )

  const markScrollbackDirty = useCallback(
    (immediate = false) => {
      if (!onScrollbackChangeRef.current) {
        hasPendingScrollbackRef.current = false
        return
      }

      hasPendingScrollbackRef.current = true

      if (isPointerResizingRef.current) {
        return
      }

      scheduleScrollbackPublish(immediate)
    },
    [isPointerResizingRef, scheduleScrollbackPublish],
  )

  const disposeScrollbackPublish = useCallback(() => {
    scheduleScrollbackPublish(true)

    if (publishTimerRef.current !== null) {
      window.clearTimeout(publishTimerRef.current)
      publishTimerRef.current = null
    }
  }, [scheduleScrollbackPublish])

  const cancelScrollbackPublish = useCallback(() => {
    hasPendingScrollbackRef.current = false

    if (publishTimerRef.current !== null) {
      window.clearTimeout(publishTimerRef.current)
      publishTimerRef.current = null
    }
  }, [])

  return {
    scrollbackBufferRef,
    markScrollbackDirty,
    scheduleScrollbackPublish,
    disposeScrollbackPublish,
    cancelScrollbackPublish,
  }
}
