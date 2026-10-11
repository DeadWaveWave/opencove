import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { Size } from '../../../types'
import { readThemeTransition } from '@contexts/plugins/presentation/renderer/themeMotion'
import { canAnimateCollapse, canvasScale, createCollapseAnimationGroup } from './collapseMotion'

const HEADER_ICON = '.cove-node-kind-icon, .cove-node-provider-icon'
const GLYPH = 'svg, img, .agent-provider-icon__monogram'
const HEADER_TEXT =
  '.node-title-editor__display, .document-node__title-text, .role-node__title, .cove-canvas-node-window__title'

function textAppearance(element: Element): Keyframe {
  const style = getComputedStyle(element)
  return {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    color: style.color,
    backgroundColor: style.backgroundColor,
    borderRadius: style.borderRadius,
    boxShadow: style.boxShadow,
  }
}

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
      !canAnimateCollapse(collapsed ? 'fold' : 'unfold')
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
    const glyph = icon?.querySelector<HTMLElement | SVGElement>(GLYPH)
    const title = compact?.querySelector<HTMLElement>('.cove-collapsed-window__title')
    const surface = shell.querySelector<HTMLElement>('.cove-node-presentation__surface')
    if (!runtime || !compact || !icon || !glyph || !title || !surface) {
      return
    }
    const details = compact.querySelectorAll('.cove-collapsed-window__pixels')
    const interrupted = new Map<Element, Record<string, string>>()
    if (active.current) {
      for (const element of [surface, glyph, title, runtime, ...details]) {
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
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          fontStyle: style.fontStyle,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          color: style.color,
          backgroundColor: style.backgroundColor,
          boxShadow: style.boxShadow,
        })
      }
    }
    active.current?.dispose()

    const headerIcon = runtime.querySelector<HTMLElement | SVGElement>(HEADER_ICON)
    const headerGlyph = headerIcon?.matches(GLYPH)
      ? headerIcon
      : headerIcon?.querySelector<HTMLElement | SVGElement>(GLYPH)
    const headerText =
      runtime.querySelector<HTMLElement>(HEADER_TEXT) ??
      runtime.querySelector<HTMLElement>('.node-title-editor, .note-node__title')
    // Website/image windows have no equivalent title; different text must fade
    // instead of moving toward a fictional header anchor.
    const headerTitle =
      headerText?.textContent?.trim() === title.textContent?.trim() ? headerText : null
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
    const compactBox = relative(compact)
    const sourceGlyph = headerGlyph ? relative(headerGlyph) : glyphBox
    const sourceTitle = headerTitle ? relative(headerTitle) : titleBox
    const titleFrame = (element: Element, box: typeof titleBox): Keyframe => ({
      left: `${box.x - compactBox.x}px`,
      top: `${box.y - compactBox.y}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
      ...textAppearance(element),
    })
    const expandedTitle = titleFrame(headerTitle ?? title, sourceTitle)
    const compactTitle = titleFrame(title, titleBox)
    const sourceColor = getComputedStyle(headerGlyph ?? glyph).color
    const compactColor = getComputedStyle(glyph).color
    const expandedRadius =
      getComputedStyle(runtime.firstElementChild ?? runtime).borderRadius || '8px'
    const compactRadius = getComputedStyle(icon).borderRadius || '13px'
    const transition = readThemeTransition(collapsed ? 'fold' : 'unfold')
    const duration = transition.durationMs
    const startDelay = collapsed ? delayRef.current : 0
    const headerAnchors = [headerIcon, headerTitle].filter(
      (element): element is HTMLElement | SVGElement => element !== null,
    )
    // Only the compact identity moves. Keep its live header anchors in normal
    // CSS so WebKit cannot retain hidden visibility from a cancelled animation.
    for (const element of headerAnchors) {
      element.setAttribute('data-cove-collapse-anchor', '')
    }
    shell.dataset.coveCollapseMotion = collapsed ? 'collapse' : 'expand'
    const group = createCollapseAnimationGroup(() => {
      for (const element of headerAnchors) {
        element.removeAttribute('data-cove-collapse-anchor')
      }
      if (active.current !== group) {
        return
      }
      delete shell.dataset.coveCollapseMotion
      active.current = null
    }, transition.easing)
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
        borderRadius: expandedRadius,
      },
      {
        left: `${iconBox.x}px`,
        top: `${iconBox.y}px`,
        width: `${iconBox.width}px`,
        height: `${iconBox.height}px`,
        borderRadius: compactRadius,
      },
    )
    morph(
      runtime,
      { clipPath: `inset(0px 0px 0px 0px round ${expandedRadius})` },
      {
        clipPath: `inset(${iconBox.y}px ${Math.max(0, expandedSize.width - iconBox.x - iconBox.width)}px ${Math.max(0, expandedSize.height - iconBox.y - iconBox.height)}px ${iconBox.x}px round ${compactRadius})`,
      },
    )
    morph(
      glyph,
      {
        transform: `translate(${sourceGlyph.x - glyphBox.x}px, ${sourceGlyph.y - glyphBox.y}px) scale(${sourceGlyph.width / glyphBox.width || 1}, ${sourceGlyph.height / glyphBox.height || 1})`,
        color: sourceColor,
        opacity: headerGlyph ? 1 : 0,
      },
      { transform: 'translate(0px, 0px) scale(1)', color: compactColor, opacity: 1 },
    )
    morph(
      title,
      { ...expandedTitle, opacity: headerTitle ? 1 : 0 },
      { ...compactTitle, opacity: 1 },
    )
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
    for (const detail of details) {
      const opacity = interrupted.get(detail)?.opacity ?? (collapsed ? 0 : 1)
      group.animate(
        detail,
        collapsed
          ? [{ opacity }, { opacity, offset: 0.5 }, { opacity: 1 }]
          : [{ opacity }, { opacity: 0, offset: 0.35 }, { opacity: 0 }],
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
