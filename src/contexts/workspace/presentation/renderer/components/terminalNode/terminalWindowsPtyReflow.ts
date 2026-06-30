import type { Terminal } from '@xterm/xterm'
import type { TerminalWindowsPty } from '@shared/contracts/dto'

const XTERM_CONPTY_SCROLLBACK_REFLOW_MIN_BUILD = 21376

type XtermWindowsPtyOptions = {
  backend?: 'conpty' | 'winpty'
  buildNumber?: number
}

type XtermRawOptions = {
  windowsPty?: XtermWindowsPtyOptions
}

type InternalXtermTerminal = Terminal & {
  _core?: {
    optionsService?: {
      rawOptions?: XtermRawOptions
    }
  }
}

function normalizePositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : null
}

export function shouldForceWindowsConptyResizeReflow(
  windowsPty: TerminalWindowsPty | XtermWindowsPtyOptions | null | undefined,
): boolean {
  if (windowsPty?.backend !== 'conpty') {
    return false
  }

  const buildNumber = normalizePositiveInt(windowsPty.buildNumber)
  return buildNumber !== null && buildNumber < XTERM_CONPTY_SCROLLBACK_REFLOW_MIN_BUILD
}

function createReflowEnabledWindowsPtyOptions(
  windowsPty: XtermWindowsPtyOptions,
): XtermWindowsPtyOptions {
  return {
    ...windowsPty,
    backend: 'conpty',
    buildNumber: XTERM_CONPTY_SCROLLBACK_REFLOW_MIN_BUILD,
  }
}

export function resizeTerminalWithWindowsConptyScrollbackReflow(
  terminal: Terminal,
  cols: number,
  rows: number,
): void {
  const rawOptions = (terminal as InternalXtermTerminal)._core?.optionsService?.rawOptions
  const windowsPty = rawOptions?.windowsPty
  if (!rawOptions || !shouldForceWindowsConptyResizeReflow(windowsPty)) {
    terminal.resize(cols, rows)
    return
  }

  const previousWindowsPty = windowsPty ?? {}
  // xterm disables scrollback reflow for old ConPTY while keeping wrap heuristics enabled.
  // During local resize only, present a reflow-capable profile without changing reported PTY truth.
  rawOptions.windowsPty = createReflowEnabledWindowsPtyOptions(previousWindowsPty)

  try {
    terminal.resize(cols, rows)
  } finally {
    rawOptions.windowsPty = previousWindowsPty
  }
}
