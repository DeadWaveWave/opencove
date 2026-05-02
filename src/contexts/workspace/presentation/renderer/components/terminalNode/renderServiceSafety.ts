import type { Terminal } from '@xterm/xterm'

export type TerminalRenderDimensions = {
  css?: {
    canvas?: { width?: number; height?: number }
    cell?: { width?: number; height?: number }
  }
  device?: {
    canvas?: { width?: number; height?: number }
  }
}

type InternalTerminal = Terminal & {
  _core?: {
    _renderService?: {
      dimensions?: TerminalRenderDimensions
    }
  }
}

function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

export function isTerminalRenderServiceDetachedError(error: unknown): boolean {
  if (!(error instanceof TypeError)) {
    return false
  }

  const message = resolveErrorMessage(error)
  return message.includes('dimensions') && (message.includes('undefined') || message.includes('null'))
}

export function readTerminalRenderDimensionsSafely(
  terminal: Terminal,
): TerminalRenderDimensions | null {
  try {
    return ((terminal as InternalTerminal)._core?._renderService?.dimensions ?? null) as
      | TerminalRenderDimensions
      | null
  } catch (error) {
    if (isTerminalRenderServiceDetachedError(error)) {
      return null
    }

    throw error
  }
}

export function runTerminalRenderMutationSafely(mutation: () => void): boolean {
  try {
    mutation()
    return true
  } catch (error) {
    if (isTerminalRenderServiceDetachedError(error)) {
      return false
    }

    throw error
  }
}
