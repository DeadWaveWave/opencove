import {
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type RefObject,
} from 'react'
import {
  readThemeMotion,
  subscribeThemeMotion,
} from '@contexts/plugins/presentation/renderer/themeMotion'
import { createThemeEffects } from '../view/pixelLayer/themeEffects'

/** Compact status retains its own semantic owner; only its decoration follows the theme. */
export function useCompactThemeMotion(
  icon: RefObject<HTMLElement | null>,
  nodeId: string,
  enabled: boolean,
  running: boolean,
) {
  const motion = useSyncExternalStore(subscribeThemeMotion, readThemeMotion, readThemeMotion)
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  )
  const effect = motion.working
  const allowed = enabled && !reduced && effect?.preset !== 'none' && effect?.durationMs !== 0
  const custom = allowed && effect?.preset === 'custom'
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media?.matches ?? false)
    media?.addEventListener('change', update)
    update()
    return () => media?.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    const element = icon.current
    if (!element || !custom) {
      return
    }
    const effects = createThemeEffects(element)
    let inView = true
    let width = element.clientWidth
    let height = element.clientHeight
    const refresh = () => {
      const working = running || element.hasAttribute('data-output-active')
      const visible = inView && document.visibilityState !== 'hidden' && width > 0 && height > 0
      effects.sync(
        { x: 0, y: 0, zoom: 1, width, height },
        working && visible
          ? [
              {
                id: nodeId,
                sessionId: '',
                rect: { x: 0, y: 0, width, height },
                tone: 'working',
                acceptsOutput: false,
              },
            ]
          : [],
        [],
        [],
        { background: false, creation: false, closing: false, working: visible },
        false,
      )
    }
    // Reuse the terminal activity owner's ephemeral attribute; no new PTY subscription.
    const output = new MutationObserver(refresh)
    output.observe(element, { attributes: true, attributeFilter: ['data-output-active'] })
    const resize = new ResizeObserver(() => {
      width = element.clientWidth
      height = element.clientHeight
      refresh()
    })
    resize.observe(element)
    const visibility =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(entries => {
            inView = entries.some(entry => entry.isIntersecting)
            refresh()
          })
        : null
    visibility?.observe(element)
    document.addEventListener('visibilitychange', refresh)
    refresh()
    return () => {
      output.disconnect()
      resize.disconnect()
      visibility?.disconnect()
      document.removeEventListener('visibilitychange', refresh)
      effects.dispose()
    }
  }, [custom, effect, icon, nodeId, running])
  const duration = effect?.durationMs
  const style: CSSProperties =
    duration === undefined
      ? {}
      : ({
          '--cove-compact-working-duration': `${duration}ms`,
          '--cove-compact-working-delay': `${(-duration * 85) / 2400}ms`,
          '--cove-compact-output-duration': `${duration}ms`,
          '--cove-compact-output-delay': `${(-duration * 32) / 1050}ms`,
        } as CSSProperties)
  return { allowed, pixel: allowed && !custom, style }
}
