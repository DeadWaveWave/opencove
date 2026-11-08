import { useEffect, useState } from 'react'

/**
 * Whether this window has focus, as main sees it; updates live. In front until the window
 * answers, so nothing waits on a question still in flight.
 */
export function useWindowFocused(): boolean {
  const [isFocused, setIsFocused] = useState(true)

  useEffect(() => {
    const windowChrome = window.opencoveApi?.windowChrome
    if (!windowChrome?.onFocusChange || !windowChrome.getFocus) {
      return undefined
    }

    let disposed = false
    // A change that lands while the first answer is in flight is newer than that answer.
    let hasChanged = false
    const unsubscribe = windowChrome.onFocusChange(state => {
      hasChanged = true
      setIsFocused(state.isFocused)
    })

    void windowChrome
      .getFocus()
      .then(state => {
        if (!disposed && !hasChanged) {
          setIsFocused(state.isFocused)
        }
      })
      .catch(() => undefined)

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  return isFocused
}
