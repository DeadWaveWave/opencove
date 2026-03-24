import { useCallback, useEffect, useState } from 'react'
import type { WorkspaceCanvasMessageTone } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/types'

export type FloatingMessageState = {
  id: number
  text: string
  tone: WorkspaceCanvasMessageTone
} | null

export function useFloatingMessage({
  timeoutMs = 3200,
}: {
  timeoutMs?: number
} = {}): {
  floatingMessage: FloatingMessageState
  showMessage: (message: string, tone?: WorkspaceCanvasMessageTone) => void
} {
  const [floatingMessage, setFloatingMessage] = useState<FloatingMessageState>(null)

  useEffect(() => {
    if (!floatingMessage) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setFloatingMessage(current => (current?.id === floatingMessage.id ? null : current))
    }, timeoutMs)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [floatingMessage, timeoutMs])

  const showMessage = useCallback(
    (message: string, tone: WorkspaceCanvasMessageTone = 'info'): void => {
      setFloatingMessage({ id: Date.now(), text: message, tone })
    },
    [],
  )

  return { floatingMessage, showMessage }
}
