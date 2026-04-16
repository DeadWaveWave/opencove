const MAIN_PROCESS_PID_ARG_PREFIX = '--opencove-main-process-pid='

export function resolveMainProcessPid(
  argv: string[] = process.argv,
  fallbackPid: number | null = typeof process.ppid === 'number' && process.ppid > 0
    ? process.ppid
    : null,
): number | null {
  for (const rawArg of argv) {
    const arg = rawArg.trim()
    if (!arg.startsWith(MAIN_PROCESS_PID_ARG_PREFIX)) {
      continue
    }

    const parsed = Number.parseInt(arg.slice(MAIN_PROCESS_PID_ARG_PREFIX.length), 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }

    return fallbackPid
  }

  return fallbackPid
}
