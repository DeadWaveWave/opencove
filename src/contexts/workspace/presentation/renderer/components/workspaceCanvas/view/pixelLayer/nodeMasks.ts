import {
  buildPixelAssemblyFrontier,
  pixelAssemblyDeadline,
  PIXEL_ASSEMBLY_READY_TIMEOUT_MS,
  PIXEL_ASSEMBLY_MS,
  type PixelAssemblyFrame,
  type PixelAssemblyClock,
} from './assembly'

const SCOPE_ATTRIBUTE = 'data-cove-pixel-mask-scope'
const MAX_PREPARED_MASKS = 32
const EMPTY_MASK = 'linear-gradient(transparent, transparent)'

function frameMask(frame: PixelAssemblyFrame): string {
  const bands = buildPixelAssemblyFrontier(frame)
  const percent = (value: number) => `${(value * 100).toFixed(5)}%`
  const images = bands.map(
    band =>
      `linear-gradient(to right, var(--cove-mask-opaque) 0%, var(--cove-mask-opaque) ${percent(band.reveal)}, transparent ${percent(band.reveal)}, transparent 100%)`,
  )
  const sizes = bands.map(band => `100% ${percent(band.height)}`)
  const positions = bands.map(band => `0% ${percent(band.top / (1 - band.height))}`)
  const front = Math.min(...bands.map(band => band.reveal))
  return `--cove-pixel-reveal-front:${front.toFixed(6)};mask-image:${images.join(',')};mask-size:${sizes.join(',')};mask-position:${positions.join(',')};mask-repeat:no-repeat;mask-mode:alpha;mask-origin:border-box;mask-clip:border-box;`
}

/** A view-owned stylesheet is registered before node commit. No node geometry or state is written. */
export function createPixelNodeMasks(
  scope: HTMLElement,
  nodeClassName = 'react-flow__node',
  durationMs = PIXEL_ASSEMBLY_MS,
) {
  const document = scope.ownerDocument
  const scopeId = crypto.randomUUID()
  const entries = new Map<string, PixelAssemblyClock & { declaration: string }>()
  let sheet: CSSStyleSheet | null = null
  let deadlineTimer: number | null = null
  let disposed = false

  const cancelDeadline = (): void => {
    if (deadlineTimer !== null) {
      window.clearTimeout(deadlineTimer)
      deadlineTimer = null
    }
  }
  const detach = (): void => {
    cancelDeadline()
    entries.clear()
    if (sheet) {
      sheet.disabled = true
      try {
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
          candidate => candidate !== sheet,
        )
      } catch {
        // A document that rejects adoption can still disable the already-owned sheet.
      }
      sheet = null
    }
    if (scope.getAttribute(SCOPE_ATTRIBUTE) === scopeId) {
      scope.removeAttribute(SCOPE_ATTRIBUTE)
    }
  }

  try {
    if (
      typeof CSSStyleSheet === 'function' &&
      typeof CSS.escape === 'function' &&
      'adoptedStyleSheets' in document
    ) {
      sheet = new CSSStyleSheet()
      sheet.replaceSync('')
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
      scope.setAttribute(SCOPE_ATTRIBUTE, scopeId)
    }
  } catch {
    detach()
  }

  const flush = (): boolean => {
    if (!sheet || disposed) {
      return false
    }
    try {
      const selector = `[${SCOPE_ATTRIBUTE}="${CSS.escape(scopeId)}"] .${CSS.escape(nodeClassName)}`
      sheet.replaceSync(
        [...entries]
          .map(([id, entry]) => `${selector}[data-id="${CSS.escape(id)}"]{${entry.declaration}}`)
          .join('\n'),
      )
      return true
    } catch {
      // Decorative CSS must always fail open, including an unsupported or lost stylesheet.
      detach()
      return false
    }
  }
  const expire = (): void => {
    const now = performance.now()
    for (const [id, entry] of entries) {
      if (now >= pixelAssemblyDeadline(entry, durationMs)) {
        entries.delete(id)
      }
    }
  }
  const scheduleDeadline = (): void => {
    cancelDeadline()
    if (!entries.size || !sheet || disposed) {
      return
    }
    const nextDeadline = Math.min(
      ...[...entries.values()].map(entry => pixelAssemblyDeadline(entry, durationMs)),
    )
    deadlineTimer = window.setTimeout(
      () => {
        deadlineTimer = null
        expire()
        flush()
        scheduleDeadline()
      },
      Math.max(0, Math.ceil(nextDeadline - performance.now())),
    )
  }

  return {
    prepare(nodeIds: string[], createdAt: number): string[] {
      if (
        !sheet ||
        disposed ||
        !Number.isFinite(createdAt) ||
        performance.now() - createdAt >= PIXEL_ASSEMBLY_READY_TIMEOUT_MS
      ) {
        return []
      }
      expire()
      const accepted: string[] = []
      for (const id of new Set(nodeIds)) {
        if (!id || (!entries.has(id) && entries.size >= MAX_PREPARED_MASKS)) {
          continue
        }
        if (!entries.has(id)) {
          entries.set(id, {
            preparedAt: createdAt,
            startedAt: null,
            declaration: `--cove-pixel-reveal-front:0;mask-image:${EMPTY_MASK};mask-size:100% 100%;mask-repeat:no-repeat;mask-mode:alpha;`,
          })
        }
        accepted.push(id)
      }
      if (!flush()) {
        return []
      }
      scheduleDeadline()
      return accepted
    },
    markReady(nodeId: string, startedAt: number): boolean {
      expire()
      const entry = entries.get(nodeId)
      if (
        !sheet ||
        disposed ||
        !entry ||
        entry.startedAt !== null ||
        !Number.isFinite(startedAt) ||
        startedAt < entry.preparedAt ||
        startedAt >= pixelAssemblyDeadline(entry, durationMs)
      ) {
        return false
      }
      entry.startedAt = startedAt
      scheduleDeadline()
      return true
    },
    update(frames: readonly PixelAssemblyFrame[], pendingIds: Iterable<string>): void {
      if (!sheet || disposed) {
        return
      }
      expire()
      const pending = new Set(pendingIds)
      const frameById = new Map(frames.map(frame => [frame.id, frame]))
      for (const [id, entry] of entries) {
        if (!pending.has(id)) {
          entries.delete(id)
          continue
        }
        const frame = frameById.get(id)
        if (frame && entry.startedAt !== null) {
          entry.declaration = frameMask(frame)
        }
      }
      flush()
      scheduleDeadline()
    },
    reveal(nodeId: string): boolean {
      const removed = entries.delete(nodeId)
      if (removed) {
        flush()
        scheduleDeadline()
      }
      return removed
    },
    clear(): void {
      entries.clear()
      cancelDeadline()
      flush()
    },
    dispose(): void {
      disposed = true
      detach()
    },
  }
}
