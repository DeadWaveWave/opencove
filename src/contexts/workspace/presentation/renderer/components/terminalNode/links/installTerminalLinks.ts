import type { IBufferRange, ILink, Terminal } from '@xterm/xterm'
import { UrlLinkProvider } from '../linkProviders/url-link-provider'
import { FilePathLinkProvider } from '../linkProviders/file-path-link-provider'
import { OperatingSystem } from '../linkProviders/link-parsing'
import {
  isTerminalLinkSnapshotCurrent,
  readTerminalLinkSnapshot,
  type TerminalDetectedLink,
} from '../linkProviders/terminal-link-snapshot'
import { dispatchTerminalLinkIntent, TERMINAL_LINK_INVALIDATION_EVENT } from './linkHostEvent'
import { installTerminalCwdObservation } from './terminalCwdObservation'
import { resolveLinkGesture, type LinkGestureAction } from './linkGesture'

function contains(range: IBufferRange, x: number, y: number): boolean {
  return (
    y >= range.start.y &&
    y <= range.end.y &&
    (y !== range.start.y || x >= range.start.x) &&
    (y !== range.end.y || x <= range.end.x)
  )
}

/** One gesture owner for native OSC 8 and detected links. No private xterm APIs. */
export function installTerminalLinks(terminal: Terminal): () => void {
  const element = terminal.element
  if (!element) {
    return () => undefined
  }
  const cwdObservation = installTerminalCwdObservation(terminal, {
    get sourceKey() {
      return element.closest<HTMLElement>('[data-cove-source-key]')?.dataset.coveSourceKey
    },
    get platform() {
      return element.closest<HTMLElement>('[data-cove-source-platform]')?.dataset
        .coveSourcePlatform === 'windows'
        ? 'windows'
        : 'posix'
    },
    get hostname() {
      return element.closest<HTMLElement>('[data-cove-source-hostname]')?.dataset.coveSourceHostname
    },
  })
  const isMac = /mac/i.test(navigator.platform)
  const urls = new UrlLinkProvider(terminal, () => undefined)
  const files = new FilePathLinkProvider(terminal, () => undefined, {
    getSourceOS: () =>
      element.closest<HTMLElement>('[data-cove-source-platform]')?.dataset.coveSourcePlatform ===
      'windows'
        ? OperatingSystem.Windows
        : OperatingSystem.Linux,
  })
  let disposed = false
  let generation = 0
  let oscGeneration = 0
  const oscLinks = new WeakMap<TerminalDetectedLink, number>()
  let hoveredOsc: TerminalDetectedLink | null = null
  let cachedOsc: TerminalDetectedLink | null = null
  let pendingOscRange: IBufferRange | null = null
  let validatingOscRange: IBufferRange | null = null
  let directGesture = false
  let draft: {
    link: TerminalDetectedLink
    action: LinkGestureAction
    x: number
    y: number
    dragged: boolean
    selection: boolean
    generation: number
  } | null = null
  let gestureClearTimer: ReturnType<typeof setTimeout> | undefined
  let menuTimer: ReturnType<typeof setTimeout> | undefined
  const cancelMenu = () => {
    clearTimeout(menuTimer)
    menuTimer = undefined
  }
  const current = (link: TerminalDetectedLink) =>
    !disposed &&
    (!oscLinks.has(link) || oscLinks.get(link) === oscGeneration) &&
    isTerminalLinkSnapshotCurrent(terminal, link.snapshot)
  const oscLink = (uri: string, range: IBufferRange): TerminalDetectedLink | null => {
    const snapshot = readTerminalLinkSnapshot(terminal, range.start.y)
    if (!snapshot) {
      return null
    }
    const link: TerminalDetectedLink = {
      text: uri,
      range,
      snapshot,
      target: /^https?:\/\//i.test(uri) ? { kind: 'url', uri } : { kind: 'file', path: uri },
    }
    oscLinks.set(link, oscGeneration)
    return link
  }
  const send = (
    action: 'hover' | 'leave' | 'menu' | 'open',
    link: TerminalDetectedLink,
    event: MouseEvent,
  ) => {
    if (!current(link)) {
      return
    }
    const version = generation
    dispatchTerminalLinkIntent(terminal.element, {
      action,
      target: link.target,
      text: link.text,
      bufferRow: link.range.start.y,
      observedCwd: cwdObservation.getContextAt(link.range.start.y)?.cwd,
      preferSystem: event.shiftKey,
      clientX: event.clientX,
      clientY: event.clientY,
      isCurrent: () => version === generation && current(link),
      focusTerminal: () => {
        if (!disposed) {
          terminal.focus()
        }
      },
    })
  }
  const position = (event: MouseEvent) => {
    const rect = element.querySelector('.xterm-screen')?.getBoundingClientRect()
    if (
      !rect ||
      rect.width <= 0 ||
      rect.height <= 0 ||
      event.clientX < rect.left ||
      event.clientX >= rect.right ||
      event.clientY < rect.top ||
      event.clientY >= rect.bottom
    ) {
      return null
    }
    return {
      x: Math.floor(((event.clientX - rect.left) * terminal.cols) / rect.width) + 1,
      y:
        Math.floor(((event.clientY - rect.top) * terminal.rows) / rect.height) +
        terminal.buffer.active.viewportY +
        1,
    }
  }
  const hit = (event: MouseEvent) => {
    const cell = position(event)
    if (!cell) {
      return null
    }
    if (cachedOsc && contains(cachedOsc.range, cell.x, cell.y)) {
      return current(cachedOsc) ? cachedOsc : null
    }
    // A displayed URL must never replace an explicit destination while xterm revalidates it.
    if (pendingOscRange && contains(pendingOscRange, cell.x, cell.y)) {
      return null
    }
    return (
      [...urls.getLinks(cell.y), ...files.getLinks(cell.y)].find(link =>
        contains(link.range, cell.x, cell.y),
      ) ?? null
    )
  }
  const consume = (event: MouseEvent) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const activate = (event: MouseEvent, link: TerminalDetectedLink) => {
    const action = resolveLinkGesture(event, isMac, terminal.modes.mouseTrackingMode !== 'none')
    if (
      !action ||
      !draft ||
      draft.dragged ||
      draft.selection ||
      terminal.hasSelection() ||
      draft.generation !== generation ||
      !current(link)
    ) {
      return
    }
    draft = null
    // Ordinary clicks must reach xterm's document mouseup to finish selection tracking.
    // The cleared draft prevents its native link callback from dispatching a second action.
    if (action === 'open') {
      consume(event)
      cancelMenu()
      send(action, link, event)
    } else {
      cancelMenu()
      menuTimer = setTimeout(() => send('menu', link, event), 250)
    }
  }
  const provider = terminal.registerLinkProvider({
    provideLinks(row, callback) {
      const links = [...urls.getLinks(row), ...files.getLinks(row)]
      callback(
        links.map(
          (link): ILink => ({
            text: link.text,
            range: link.range,
            activate: event => activate(event, link),
            hover: event => {
              const cell = position(event)
              if (
                validatingOscRange &&
                cachedOsc &&
                cell &&
                contains(cachedOsc.range, cell.x, cell.y)
              ) {
                cachedOsc = null
              }
              send('hover', link, event)
            },
            leave: event => send('leave', link, event),
          }),
        ),
      )
    },
  })
  const previousHandler = terminal.options.linkHandler
  terminal.options.linkHandler = {
    allowNonHttpProtocols: true,
    hover(event, uri, range) {
      if (
        cachedOsc &&
        !current(cachedOsc) &&
        contains(cachedOsc.range, range.start.x, range.start.y) &&
        !validatingOscRange
      ) {
        // Re-entering a cell can reuse xterm's old provider reply. Only a rendered-row
        // re-evaluation confirms OSC attributes after output changed.
        refreshOsc(range)
        return
      }
      hoveredOsc = oscLink(uri, range)
      if (!hoveredOsc) {
        return
      }
      cachedOsc = hoveredOsc
      pendingOscRange = null
      send('hover', hoveredOsc, event)
    },
    leave(event) {
      if (hoveredOsc) {
        send('leave', hoveredOsc, event)
      }
      hoveredOsc = null
    },
    activate(event, uri, range) {
      const link = oscLink(uri, range)
      if (link) {
        activate(event, link)
      }
    },
  }
  const down = (event: MouseEvent) => {
    cancelMenu()
    directGesture = false
    const action = resolveLinkGesture(event, isMac, terminal.modes.mouseTrackingMode !== 'none')
    const link = action ? hit(event) : null
    const cell = position(event)
    const blockedOscRange =
      pendingOscRange ?? (cachedOsc && !current(cachedOsc) ? cachedOsc.range : null)
    if (action === 'open' && blockedOscRange && cell && contains(blockedOscRange, cell.x, cell.y)) {
      directGesture = true
      consume(event)
    }
    draft = link
      ? {
          link,
          action,
          x: event.clientX,
          y: event.clientY,
          dragged: false,
          selection: terminal.hasSelection(),
          generation,
        }
      : null
    if (draft && !draft.selection) {
      element.dataset.coveLinkGesture = 'true'
      // Direct navigation must not also enter xterm's selection or PTY mouse handlers.
      if (action === 'open') {
        directGesture = true
        consume(event)
      }
    }
  }
  const move = (event: MouseEvent) => {
    if (draft && Math.hypot(event.clientX - draft.x, event.clientY - draft.y) > 4) {
      draft.dragged = true
    }
  }
  const up = (event: MouseEvent) => {
    // An invalidation between down/up must not leak the second half of a consumed gesture.
    if (directGesture) {
      consume(event)
      directGesture = false
    }
    const link = hit(event)
    if (
      draft &&
      link &&
      draft.link.text === link.text &&
      draft.link.snapshot.fingerprint === link.snapshot.fingerprint
    ) {
      activate(event, link)
    }
    draft = null
    clearTimeout(gestureClearTimer)
    gestureClearTimer = setTimeout(() => {
      delete element.dataset.coveLinkGesture
    }, 0)
  }
  const refreshOsc = (oscRange: IBufferRange | null) => {
    if (disposed || !oscRange) {
      return
    }
    const start = Math.max(0, oscRange.start.y - terminal.buffer.active.viewportY - 1)
    const end = Math.min(terminal.rows - 1, oscRange.end.y - terminal.buffer.active.viewportY - 1)
    if (start <= end) {
      pendingOscRange = oscRange
      // Native OSC 8 hover is cached by xterm until its row renders. Output on other rows
      // must refresh this public adapter too; a text fingerprint cannot validate OSC attrs.
      terminal.refresh(start, end)
    }
  }
  const invalidate = () => {
    element.dispatchEvent(new Event(TERMINAL_LINK_INVALIDATION_EVENT, { bubbles: true }))
  }
  const clear = () => {
    const oscRange = hoveredOsc?.range ?? pendingOscRange ?? cachedOsc?.range ?? null
    generation++
    oscGeneration++
    draft = null
    hoveredOsc = null
    pendingOscRange = null
    validatingOscRange = null
    cancelMenu()
    clearTimeout(gestureClearTimer)
    delete element.dataset.coveLinkGesture
    invalidate()
    refreshOsc(oscRange)
  }
  const written = () => {
    const oscRange = hoveredOsc?.range ?? pendingOscRange ?? cachedOsc?.range ?? null
    // Text links remain current while their own logical line is unchanged. OSC attributes
    // are not exposed by the public buffer API, so they require a fresh native observation.
    oscGeneration++
    hoveredOsc = null
    pendingOscRange = null
    validatingOscRange = null
    if (draft && !current(draft.link)) {
      draft = null
      delete element.dataset.coveLinkGesture
    }
    invalidate()
    refreshOsc(oscRange)
  }
  const releaseOutside = (event: MouseEvent) => {
    if (event.target instanceof Node && !element.contains(event.target)) {
      if (directGesture) {
        consume(event)
        directGesture = false
      }
      draft = null
      delete element.dataset.coveLinkGesture
    }
  }
  const blur = () => {
    directGesture = false
    clear()
  }
  const doubleClick = () => cancelMenu()
  element.addEventListener('mousedown', down, true)
  element.addEventListener('mouseup', up, true)
  element.addEventListener('dblclick', doubleClick, true)
  window.addEventListener('mouseup', releaseOutside, true)
  window.addEventListener('mousemove', move, true)
  window.addEventListener('blur', blur)
  const subscriptions = [
    terminal.onResize(clear),
    terminal.onScroll(clear),
    terminal.onWriteParsed(written),
    terminal.onRender(({ start, end }) => {
      const range = pendingOscRange
      const viewportY = terminal.buffer.active.viewportY
      if (
        range &&
        Math.max(0, range.start.y - viewportY - 1) >= start &&
        Math.min(terminal.rows - 1, range.end.y - viewportY - 1) <= end
      ) {
        const version = generation
        const oscVersion = oscGeneration
        validatingOscRange = range
        // Run after all synchronous native link-provider callbacks for this render.
        queueMicrotask(() => {
          if (version === generation && oscVersion === oscGeneration && pendingOscRange === range) {
            pendingOscRange = null
          }
          if (validatingOscRange === range) {
            validatingOscRange = null
          }
        })
      }
    }),
  ]
  return () => {
    disposed = true
    directGesture = false
    clear()
    cwdObservation.dispose()
    provider.dispose()
    subscriptions.forEach(item => item.dispose())
    terminal.options.linkHandler = previousHandler
    element.removeEventListener('mousedown', down, true)
    element.removeEventListener('mouseup', up, true)
    element.removeEventListener('dblclick', doubleClick, true)
    window.removeEventListener('mouseup', releaseOutside, true)
    window.removeEventListener('mousemove', move, true)
    window.removeEventListener('blur', blur)
  }
}
