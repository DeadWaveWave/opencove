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

export function normalizeBrowserPtySessionState(value: unknown): 'working' | 'standby' | null {
  return value === 'working' || value === 'standby' ? value : null
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
