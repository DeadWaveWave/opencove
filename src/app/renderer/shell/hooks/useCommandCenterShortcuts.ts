import { useEffect } from 'react'

function isCommandCenterShortcut(event: KeyboardEvent): boolean {
  if (event.isComposing) {
    return false
  }

  if (event.altKey) {
    return false
  }

  const hasCommandOrControl = event.metaKey || event.ctrlKey
  if (!hasCommandOrControl) {
    return false
  }

  const key = event.key.toLowerCase()
  return key === 'k' || key === 'p'
}

export function useCommandCenterShortcuts({
  enabled,
  onToggle,
}: {
  enabled: boolean
  onToggle: () => void
}): void {
  useEffect(() => {
    if (!enabled) {
      return
    }

    const handler = (event: KeyboardEvent): void => {
      if (!isCommandCenterShortcut(event)) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      onToggle()
    }

    window.addEventListener('keydown', handler, { capture: true })
    return () => {
      window.removeEventListener('keydown', handler, { capture: true })
    }
  }, [enabled, onToggle])
}
