import { useEffect, useState } from 'react'

/** Whether this window is in native full screen; updates live. Windowed until the window answers. */
export function useWindowFullScreen(): boolean {
  const [isFullScreen, setIsFullScreen] = useState(false)

  useEffect(() => {
    const windowChrome = window.opencoveApi?.windowChrome
    if (!windowChrome?.onFullScreenChange || !windowChrome.getFullScreen) {
      return undefined
    }

    let disposed = false
    // A change that lands while the first answer is in flight is newer than that answer.
    let hasChanged = false
    const unsubscribe = windowChrome.onFullScreenChange(state => {
      hasChanged = true
      setIsFullScreen(state.isFullScreen)
    })

    void windowChrome
      .getFullScreen()
      .then(state => {
        if (!disposed && !hasChanged) {
          setIsFullScreen(state.isFullScreen)
        }
      })
      .catch(() => undefined)

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  return isFullScreen
}
