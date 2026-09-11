export type ApplicationShortcutEvent = 'close-selected-node' | 'quit-armed' | 'quit-cancelled'

export function isApplicationShortcutEvent(value: unknown): value is ApplicationShortcutEvent {
  return value === 'close-selected-node' || value === 'quit-armed' || value === 'quit-cancelled'
}
