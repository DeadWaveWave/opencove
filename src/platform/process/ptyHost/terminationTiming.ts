/** Shared policy bounds used by the scheduler, host shutdown and its supervisor. */
export const AGENT_RETIREMENT_BUDGET_MS = 3_000
export const PTY_HOST_SHUTDOWN_TIMEOUT_MS = AGENT_RETIREMENT_BUDGET_MS + 1_000
export const PTY_HOST_EXIT_CONFIRM_TIMEOUT_MS = 500
