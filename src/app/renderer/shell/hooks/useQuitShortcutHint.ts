import { useEffect, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { FloatingMessageState } from './useFloatingMessage'

export function useQuitShortcutHint(): FloatingMessageState {
  const [armed, setArmed] = useState(false)
  const { t } = useTranslation()
  useEffect(
    () =>
      window.opencoveApi?.lifecycle?.onApplicationShortcut?.(event => {
        if (event === 'quit-armed') {
          setArmed(true)
        }
        if (event === 'quit-cancelled') {
          setArmed(false)
        }
      }),
    [],
  )
  return armed
    ? {
        id: 0,
        tone: 'warning',
        text: t('common.quitShortcutHint', {
          shortcut: window.opencoveApi?.meta?.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
        }),
      }
    : null
}
