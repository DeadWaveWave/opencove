import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type MutableRefObject,
  type RefCallback,
} from 'react'
import type { Terminal } from '@xterm/xterm'

const persistedTranscriptTextByNodeId = new Map<string, string>()
const terminalRefsByNodeId = new Map<string, MutableRefObject<Terminal | null>>()

type TranscriptDebugWindow = Window & {
  __OPENCOVE_TEST_TERMINAL_TRANSCRIPTS__?: Record<string, string>
  __OPENCOVE_TEST_READ_TERMINAL_TRANSCRIPT__?: (nodeId: string) => string
}

function writePersistedTranscript(nodeId: string, text: string): void {
  if (text.length > 0) {
    persistedTranscriptTextByNodeId.set(nodeId, text)
  } else {
    persistedTranscriptTextByNodeId.delete(nodeId)
  }

  if (typeof window === 'undefined') {
    return
  }

  const debugWindow = window as TranscriptDebugWindow
  const transcripts = (debugWindow.__OPENCOVE_TEST_TERMINAL_TRANSCRIPTS__ ??= {})
  debugWindow.__OPENCOVE_TEST_READ_TERMINAL_TRANSCRIPT__ = currentNodeId => {
    const terminalRef = terminalRefsByNodeId.get(currentNodeId)
    if (terminalRef?.current) {
      return captureTerminalVisibleText(terminalRef.current)
    }

    return persistedTranscriptTextByNodeId.get(currentNodeId) ?? ''
  }
  if (text.length > 0) {
    transcripts[nodeId] = text
    return
  }

  delete transcripts[nodeId]
}

function captureTerminalVisibleText(terminal: Terminal): string {
  const activeBuffer = terminal.buffer?.active
  if (!activeBuffer || typeof activeBuffer.length !== 'number') {
    return ''
  }

  const lines: string[] = []

  for (let index = 0; index < activeBuffer.length; index += 1) {
    const line = activeBuffer.getLine(index)
    if (!line) {
      continue
    }

    lines.push(line.translateToString(true))
  }

  const text = lines.join('\n')
  return text.trim().length > 0 ? text : ''
}

function isTerminalMouseInputEchoOnly(text: string): boolean {
  const compact = text.replace(/\s+/gu, '')

  return compact.length > 0 && /^(?:\^\[\[<\d+;\d+;\d+[mM])+$/u.test(compact)
}

function shouldKeepPersistedTranscript(options: {
  nextText: string
  persistedText: string
}): boolean {
  return options.persistedText.trim().length > 0 && isTerminalMouseInputEchoOnly(options.nextText)
}

export function useTerminalTestTranscriptMirror({
  enabled,
  nodeId,
  resetKey,
  terminalRef,
}: {
  enabled: boolean
  nodeId: string
  resetKey: string
  terminalRef: MutableRefObject<Terminal | null>
}): {
  transcriptRef: RefCallback<HTMLDivElement>
  scheduleTranscriptSync: () => void
} {
  const transcriptElementRef = useRef<HTMLDivElement | null>(null)
  const pendingFrameRef = useRef<number | null>(null)
  const lastNonEmptyTextRef = useRef('')
  const transcriptRef = useCallback<RefCallback<HTMLDivElement>>(
    element => {
      transcriptElementRef.current = element
      if (!element) {
        return
      }

      const persistedText =
        lastNonEmptyTextRef.current.length > 0
          ? lastNonEmptyTextRef.current
          : (persistedTranscriptTextByNodeId.get(nodeId) ?? '')
      if (persistedText.length > 0) {
        element.textContent = persistedText
      }
    },
    [nodeId],
  )

  const cancelPendingSync = useCallback(() => {
    if (pendingFrameRef.current === null) {
      return
    }

    cancelAnimationFrame(pendingFrameRef.current)
    pendingFrameRef.current = null
  }, [])

  useEffect(() => {
    if (!enabled) {
      return () => undefined
    }

    terminalRefsByNodeId.set(nodeId, terminalRef)
    writePersistedTranscript(nodeId, persistedTranscriptTextByNodeId.get(nodeId) ?? '')

    return () => {
      terminalRefsByNodeId.delete(nodeId)
    }
  }, [enabled, nodeId, terminalRef])

  const scheduleTranscriptSync = useCallback(() => {
    if (!enabled || pendingFrameRef.current !== null) {
      return
    }

    pendingFrameRef.current = requestAnimationFrame(() => {
      pendingFrameRef.current = null

      const transcriptElement = transcriptElementRef.current
      if (!transcriptElement) {
        return
      }

      const terminal = terminalRef.current
      const nextText = terminal ? captureTerminalVisibleText(terminal) : ''
      if (nextText.length === 0 && transcriptElement.textContent?.trim().length) {
        return
      }

      const persistedText =
        lastNonEmptyTextRef.current.length > 0
          ? lastNonEmptyTextRef.current
          : (persistedTranscriptTextByNodeId.get(nodeId) ?? '')
      if (shouldKeepPersistedTranscript({ nextText, persistedText })) {
        transcriptElement.textContent = persistedText
        return
      }

      if (nextText.length === 0 && persistedText.length > 0) {
        transcriptElement.textContent = persistedText
        return
      }

      if (nextText.length > 0) {
        lastNonEmptyTextRef.current = nextText
        writePersistedTranscript(nodeId, nextText)
      }

      transcriptElement.textContent = nextText
    })
  }, [enabled, nodeId, terminalRef])

  useLayoutEffect(() => {
    cancelPendingSync()

    const transcriptElement = transcriptElementRef.current
    if (!transcriptElement) {
      return
    }

    const terminal = terminalRef.current
    const nextText = terminal ? captureTerminalVisibleText(terminal) : ''
    if (nextText.length > 0) {
      lastNonEmptyTextRef.current = nextText
      writePersistedTranscript(nodeId, nextText)
      transcriptElement.textContent = nextText
      return
    }

    const persistedText =
      lastNonEmptyTextRef.current.length > 0
        ? lastNonEmptyTextRef.current
        : (persistedTranscriptTextByNodeId.get(nodeId) ?? '')
    if (persistedText.length > 0) {
      lastNonEmptyTextRef.current = persistedText
      transcriptElement.textContent = persistedText
    }
  }, [cancelPendingSync, nodeId, resetKey, terminalRef])

  useEffect(() => {
    if (enabled) {
      return () => {
        cancelPendingSync()
      }
    }

    cancelPendingSync()
    lastNonEmptyTextRef.current = ''
    writePersistedTranscript(nodeId, '')
    if (transcriptElementRef.current) {
      transcriptElementRef.current.textContent = ''
    }

    return () => undefined
  }, [cancelPendingSync, enabled, nodeId])

  return {
    transcriptRef,
    scheduleTranscriptSync,
  }
}
