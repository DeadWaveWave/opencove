export type BrowserPtyListenerMap<TEvent> = Set<(event: TEvent) => void>

export function normalizeBrowserPtyAttachAfterSeq(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null
  }
  return Math.floor(value)
}

export function emitBrowserPtyEvent<TEvent>(
  listeners: BrowserPtyListenerMap<TEvent>,
  event: TEvent,
): void {
  listeners.forEach(listener => {
    listener(event)
  })
}

export function normalizeBrowserPtySessionState(
  value: unknown,
): 'working' | 'waiting' | 'standby' | null {
  return value === 'working' || value === 'waiting' || value === 'standby' ? value : null
}

export function normalizeBrowserPtyStateMetadata(
  record: Record<string, unknown>,
): Partial<Pick<TerminalSessionStateEvent, 'source' | 'hookInstallState'>> {
  const source: TerminalSessionStateSource | null =
    record.source === 'launch' ||
    record.source === 'session_file' ||
    record.source === 'claude_hook'
      ? record.source
      : null
  const hookInstallState: AgentHookInstallState | null =
    record.hookInstallState === 'installed' ||
    record.hookInstallState === 'partial' ||
    record.hookInstallState === 'not_installed' ||
    record.hookInstallState === 'error' ||
    record.hookInstallState === 'skipped'
      ? record.hookInstallState
      : null
  return {
    ...(source ? { source } : {}),
    ...(hookInstallState ? { hookInstallState } : {}),
  }
}

export function normalizeBrowserPtyPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }
  return Math.floor(value)
}

export function normalizeBrowserPtyNonNegativeInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null
  }
  return Math.floor(value)
}
import type {
  AgentHookInstallState,
  TerminalSessionStateEvent,
  TerminalSessionStateSource,
} from '@shared/contracts/dto'
