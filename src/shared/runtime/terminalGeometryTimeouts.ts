// Cold Windows processes and the shared Console observer start before native confirmation.
export const WINDOWS_PTY_RESIZE_STARTUP_TIMEOUT_MS = 5_000
export const WINDOWS_PTY_RESIZE_CONFIRMATION_TIMEOUT_MS = 2_000

// Desktop and Web clients may target a Windows Worker regardless of their own platform.
// Include both bounded Host phases and time for the correlated result to cross the transport.
export const TERMINAL_GEOMETRY_ACK_TIMEOUT_MS =
  WINDOWS_PTY_RESIZE_STARTUP_TIMEOUT_MS + WINDOWS_PTY_RESIZE_CONFIRMATION_TIMEOUT_MS + 1_000
