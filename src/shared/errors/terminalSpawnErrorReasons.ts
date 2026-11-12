import type { AppErrorCode, AppErrorDescriptor } from '../contracts/dto'

const APPLICATION_REASONS = {
  initial_prompt_unsupported: {
    code: 'common.invalid_input',
    message:
      'This prompt could run a provider command instead of starting a conversation. Rephrase the task, or open a blank session and enter provider controls there. Your text has been kept.',
  },
  native_wsl_worker_required: {
    code: 'common.unavailable',
    message: 'To create this terminal, connect to a Worker running inside WSL.',
  },
  wsl_input_file_unavailable: {
    code: 'common.unavailable',
    message:
      'OpenCove cannot open an input file in this WSL profile. Choose a profile that can access the file.',
  },
} as const satisfies Record<string, { code: AppErrorCode; message: string }>
export type TerminalSpawnApplicationReason = keyof typeof APPLICATION_REASONS

export function terminalSpawnApplicationDescriptor(
  reason: TerminalSpawnApplicationReason,
): AppErrorDescriptor & { debugMessage: string } {
  const entry = APPLICATION_REASONS[reason]
  return { code: entry.code, details: { reason }, debugMessage: entry.message }
}

/** Rebuild only known code/reason pairs; wire errors never supply public prose or extra fields. */
export function publicTerminalSpawnApplicationError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return undefined
  }
  const { code, details } = error as { code?: unknown; details?: unknown }
  if (!details || typeof details !== 'object') {
    return undefined
  }
  const { reason } = details as { reason?: unknown }
  if (typeof reason !== 'string' || !Object.hasOwn(APPLICATION_REASONS, reason)) {
    return undefined
  }
  const descriptor = terminalSpawnApplicationDescriptor(reason as TerminalSpawnApplicationReason)
  return code === descriptor.code ? descriptor : undefined
}
