export const QUIT_CONFIRMATION_INTERVAL_MS = 1_500

interface ShortcutInput {
  type: string
  key: string
  meta: boolean
  control: boolean
  alt: boolean
  shift: boolean
  isAutoRepeat: boolean
}

export type ShortcutAction = 'close-selected-node' | 'quit-armed' | 'quit'

export function createApplicationShortcutPolicy(platform: string, now = () => performance.now()) {
  let armedAt: number | null = null
  let quitting = false

  const reset = (): void => {
    armedAt = null
  }

  return {
    reset,
    hasPendingQuit: (): boolean => armedAt !== null,
    handle(input: ShortcutInput): {
      consumed: boolean
      action?: ShortcutAction
      cancelled?: boolean
    } {
      const key = input.key.toLowerCase()
      const modifier =
        platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta
      const chord = modifier && !input.alt && !input.shift
      if (chord && (key === 'w' || (key === 'q' && platform === 'darwin'))) {
        if (input.type !== 'keyDown' || input.isAutoRepeat || quitting) {
          return { consumed: true }
        }
        if (key === 'w') {
          const cancelled = armedAt !== null
          reset()
          return {
            consumed: true,
            action: 'close-selected-node',
            ...(cancelled ? { cancelled: true } : {}),
          }
        }
        const timestamp = now()
        if (armedAt !== null && timestamp - armedAt < QUIT_CONFIRMATION_INTERVAL_MS) {
          quitting = true
          reset()
          return { consumed: true, action: 'quit' }
        }
        armedAt = timestamp
        return { consumed: true, action: 'quit-armed' }
      }
      if (input.type === 'keyDown' && !['meta', 'control'].includes(key)) {
        const cancelled = armedAt !== null
        reset()
        return { consumed: false, ...(cancelled ? { cancelled: true } : {}) }
      }
      return { consumed: false }
    },
  }
}
