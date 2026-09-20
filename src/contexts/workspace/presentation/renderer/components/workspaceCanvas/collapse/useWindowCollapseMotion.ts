import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { Size } from '../../../types'
import {
  canAnimateCollapse,
  canvasScale,
  createCollapseAnimationGroup,
  WINDOW_FOLD_MS,
  WINDOW_UNFOLD_MS,
} from './collapseMotion'

const HEADER_ICON = '.cove-node-kind-icon, .cove-node-provider-icon'
const HEADER_TITLE =
  '.node-title-editor, .terminal-node__title, .document-node__title, .role-node__title, .task-node__title'

/** Morph only the shell. Text/editor/PTY content never scales or reflows. */
export function useWindowCollapseMotion(
  ref: RefObject<HTMLDivElement | null>,
  collapsed: boolean,
  hidden: boolean,
  expandedSize: Size,
  compactSize: Size,
  delay: number,
) {
  const previous = useRef({ collapsed, hidden, size: collapsed ? compactSize : expandedSize })
  const active = useRef<ReturnType<typeof createCollapseAnimationGroup> | null>(null)
  // Timing belongs to the disclosure transaction, not subsequent status renders.
  const delayRef = useRef(delay)
  delayRef.current = delay
  useLayoutEffect(() => {
    const before = previous.current
    const size = {
      width: collapsed ? compactSize.width : expandedSize.width,
      height: collapsed ? compactSize.height : expandedSize.height,
    }
    previous.current = { collapsed, hidden, size }
    const shell = ref.current
    if (
      !shell ||
      before.collapsed === collapsed ||
      hidden ||
      before.hidden ||
      !canAnimateCollapse()
    ) {
      active.current?.dispose()
      return
    }
    const scale = canvasScale(shell)
    const currentRect = shell.getBoundingClientRect()
    const fromSize = active.current
      ? { width: currentRect.width / scale, height: currentRect.height / scale }
      : before.size
    const runtime = shell.querySelector<HTMLElement>('.cove-node-presentation__runtime')
    const compact = shell.querySelector<HTMLElement>('.cove-collapsed-window')
    const icon = compact?.querySelector<HTMLElement>('.cove-collapsed-window__icon')
    const glyph = icon?.querySelector<HTMLElement>('svg, .agent-provider-icon')
    const title = compact?.querySelector<HTMLElement>('.cove-collapsed-window__title')
    const surface = shell.querySelector<HTMLElement>('.cove-node-presentation__surface')
    if (!runtime || !compact || !icon || !glyph || !title || !surface) {
      return
    }
    const interrupted = new Map<Element, Record<string, string>>()
    if (active.current) {
      for (const element of [surface, glyph, title, runtime]) {
        // ComputedStyle is live; copy the properties before cancel removes them.
        const style = getComputedStyle(element)
        interrupted.set(element, {
          left: style.left,
          top: style.top,
          width: style.width,
          height: style.height,
          borderRadius: style.borderRadius,
          transform: style.transform,
          maxWidth: style.maxWidth,
          opacity: style.opacity,
          clipPath: style.clipPath,
        })
      }
    }
    active.current?.dispose()

    const headerIcon = runtime.querySelector<HTMLElement>(HEADER_ICON)
    const headerTitle = runtime.querySelector<HTMLElement>(HEADER_TITLE)
    const origin = shell.getBoundingClientRect()
    const relative = (element: Element) => {
      const rect = element.getBoundingClientRect()
      return {
        x: (rect.x - origin.x) / scale,
        y: (rect.y - origin.y) / scale,
        width: rect.width / scale,
        height: rect.height / scale,
      }
    }
    const iconBox = relative(icon)
    const glyphBox = relative(glyph)
    const titleBox = relative(title)
    const sourceGlyph = headerIcon ? relative(headerIcon) : { x: 12, y: 12, width: 16, height: 16 }
    const sourceTitle = headerTitle
      ? relative(headerTitle)
      : { x: 38, y: 10, width: expandedSize.width - 100, height: 18 }
    const duration = collapsed ? WINDOW_FOLD_MS : WINDOW_UNFOLD_MS
    const startDelay = collapsed ? delayRef.current : 0
    shell.dataset.coveCollapseMotion = collapsed ? 'collapse' : 'expand'
    const group = createCollapseAnimationGroup(() => {
      if (active.current !== group) {
        return
      }
      delete shell.dataset.coveCollapseMotion
      active.current = null
    })
    active.current = group
    const morph = (element: Element, expanded: Keyframe, folded: Keyframe) => {
      const start = collapsed ? expanded : folded
      const current = interrupted.get(element)
      const from = current
        ? Object.fromEntries(Object.keys(start).map(key => [key, current[key]]))
        : start
      group.animate(element, [from, collapsed ? folded : expanded], duration, startDelay)
    }
    group.animate(
      shell,
      [
        { width: `${fromSize.width}px`, height: `${fromSize.height}px` },
        { width: `${size.width}px`, height: `${size.height}px` },
      ],
      duration,
      startDelay,
    )
    morph(
      surface,
      {
        left: '0px',
        top: '0px',
        width: `${expandedSize.width}px`,
        height: `${expandedSize.height}px`,
        borderRadius: '8px',
      },
      {
        left: `${iconBox.x}px`,
        top: `${iconBox.y}px`,
        width: `${iconBox.width}px`,
        height: `${iconBox.height}px`,
        borderRadius: '13px',
      },
    )
    morph(
      runtime,
      { clipPath: 'inset(0px 0px 0px 0px round 8px)' },
      {
        clipPath: `inset(${iconBox.y}px ${Math.max(0, expandedSize.width - iconBox.x - iconBox.width)}px ${Math.max(0, expandedSize.height - iconBox.y - iconBox.height)}px ${iconBox.x}px round 13px)`,
      },
    )
    morph(
      glyph,
      {
        transform: `translate(${sourceGlyph.x - glyphBox.x}px, ${sourceGlyph.y - glyphBox.y}px) scale(${sourceGlyph.height / glyphBox.height || 1})`,
      },
      { transform: 'translate(0px, 0px) scale(1)' },
    )
    morph(
      title,
      {
        transform: `translate(${sourceTitle.x - titleBox.x}px, ${sourceTitle.y - titleBox.y}px)`,
        maxWidth: `${Math.max(40, sourceTitle.width)}px`,
      },
      { transform: 'translate(0px, 0px)', maxWidth: '152px' },
    )
    for (const element of [headerIcon, headerTitle]) {
      if (element) {
        group.animate(element, [{ opacity: 0 }, { opacity: 0 }], duration, startDelay)
      }
    }
    group.animate(
      runtime,
      collapsed
        ? [
            { opacity: interrupted.get(runtime)?.opacity ?? 1 },
            { opacity: 0, offset: 0.48 },
            { opacity: 0 },
          ]
        : [
            { opacity: interrupted.get(runtime)?.opacity ?? 0 },
            { opacity: 0, offset: 0.3 },
            { opacity: 1 },
          ],
      duration,
      startDelay,
    )
    for (const detail of compact.querySelectorAll(
      '.cove-collapsed-window__status, .cove-collapsed-window__message, .cove-collapsed-window__pixels, .cove-collapsed-window__close',
    )) {
      group.animate(
        detail,
        collapsed
          ? [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }]
          : [{ opacity: 1 }, { opacity: 0, offset: 0.35 }, { opacity: 0 }],
        duration,
        startDelay,
      )
    }
    group.finish()
  }, [
    collapsed,
    hidden,
    expandedSize.width,
    expandedSize.height,
    compactSize.width,
    compactSize.height,
    ref,
  ])

  useEffect(() => {
    const shell = ref.current
    const cancel = () => active.current?.dispose()
    const cancelDrag = (event: PointerEvent) => {
      if (event.buttons !== 0) {
        cancel()
      }
    }
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    shell?.addEventListener('pointermove', cancelDrag, true)
    media?.addEventListener('change', cancel)
    return () => {
      shell?.removeEventListener('pointermove', cancelDrag, true)
      media?.removeEventListener('change', cancel)
      cancel()
    }
  }, [ref])
}
