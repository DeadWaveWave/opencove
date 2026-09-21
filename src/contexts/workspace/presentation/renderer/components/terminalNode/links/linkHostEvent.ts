import type { TerminalLinkTarget } from '../linkProviders/terminal-link-snapshot'

export const TERMINAL_LINK_INVALIDATION_EVENT = 'opencove:terminal-links-invalidated'

export const TERMINAL_LINK_EVENT = 'opencove:terminal-link'

export interface TerminalLinkIntent {
  action: 'hover' | 'leave' | 'menu' | 'open'
  target: TerminalLinkTarget
  text: string
  clientX: number
  clientY: number
  bufferRow: number
  observedCwd?: string
  preferSystem?: boolean
  isCurrent: () => boolean
  focusTerminal: () => void
}

export function dispatchTerminalLinkIntent(
  element: HTMLElement | undefined,
  intent: TerminalLinkIntent,
): void {
  element?.dispatchEvent(
    new CustomEvent<TerminalLinkIntent>(TERMINAL_LINK_EVENT, {
      detail: intent,
      bubbles: true,
    }),
  )
}
