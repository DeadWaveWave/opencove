import type { AppErrorCode } from '../contracts/dto/error'
const taskAuthorityMessageKeys = {
  'task.closed': 'taskClosed',
  'task.claimed': 'taskClaimed',
  'task.holder_busy': 'taskHolderBusy',
  'task.stale': 'taskStale',
  'task.text_stale': 'taskTextStale',
  'task.text_too_large': 'taskTextTooLarge',
  'task.request_mismatch': 'taskRequestMismatch',
  'task.legacy_conflict': 'taskLegacyConflict',
} as const
export function taskAuthorityErrorMessageKey(code: AppErrorCode): string | null {
  return Object.hasOwn(taskAuthorityMessageKeys, code)
    ? taskAuthorityMessageKeys[code as keyof typeof taskAuthorityMessageKeys]
    : null
}
