import type { TerminalDetectedLink } from '../linkProviders/terminal-link-snapshot'

/** Owns the single-click delay and waits for native OSC validation without polling. */
export function createTerminalLinkMenu(
  resolve: (link: TerminalDetectedLink) => TerminalDetectedLink | null | undefined,
  show: (link: TerminalDetectedLink, event: MouseEvent) => void,
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: { link: TerminalDetectedLink; event: MouseEvent; ready: boolean } | null = null
  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
    pending = null
  }
  const flush = () => {
    if (!pending) {
      return
    }
    const link = resolve(pending.link)
    // undefined means native revalidation is still pending; null rejects the old target.
    if (link === null) {
      cancel()
    } else if (link && pending.ready) {
      const { event } = pending
      cancel()
      show(link, event)
    }
  }
  return {
    cancel,
    flush,
    schedule(link: TerminalDetectedLink, event: MouseEvent) {
      cancel()
      pending = { link, event, ready: false }
      timer = setTimeout(() => {
        timer = undefined
        if (pending) {
          pending.ready = true
          flush()
        }
      }, 250)
    },
  }
}
