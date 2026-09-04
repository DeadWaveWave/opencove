import { useRef } from 'react'

export type TerminalLiveReattachScope = {
  sessionId: string
  isLiveSessionReattach: boolean
}

export function retainTerminalLiveReattachScope(
  current: TerminalLiveReattachScope,
  next: TerminalLiveReattachScope,
): TerminalLiveReattachScope {
  return current.sessionId === next.sessionId ? current : next
}

export function useTerminalLiveReattachScope(
  sessionId: string,
  isLiveSessionReattach: boolean,
): boolean {
  const scopeRef = useRef({ sessionId, isLiveSessionReattach })
  scopeRef.current = retainTerminalLiveReattachScope(scopeRef.current, {
    sessionId,
    isLiveSessionReattach,
  })
  return scopeRef.current.isLiveSessionReattach
}
