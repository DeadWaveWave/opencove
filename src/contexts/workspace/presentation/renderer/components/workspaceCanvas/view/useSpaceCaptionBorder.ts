import { useLayoutEffect, useRef, type RefObject } from 'react'
import { buildSpaceCaptionBorderClip, resolveSpaceCaptionGaps } from './spaceCaptionBorder'
import type { SpaceCaptionBounds } from './spaceCaptionBorder'
import { SPACE_VISUAL_SCALE_EVENT } from './spaceVisualScale'

const CLIP_PROPERTY = '--cove-space-border-clip'

function isHidden(element: HTMLElement, style: CSSStyleDeclaration) {
  return (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.opacity === '0' ||
    style.clipPath === 'inset(50%)' ||
    element.hidden
  )
}

function readVisibleBounds(caption: HTMLElement): SpaceCaptionBounds[] {
  if (isHidden(caption, getComputedStyle(caption))) {
    return []
  }
  const bounds = caption.getBoundingClientRect()
  const group = caption.closest<HTMLElement>('.workspace-space-region__label-group')
  if (!group) {
    return [bounds]
  }
  const style = getComputedStyle(group)
  if (isHidden(group, style)) {
    return []
  }
  const groupBounds = group.getBoundingClientRect()
  const clipsX = ['hidden', 'clip'].includes(style.overflowX)
  const clipsY = ['hidden', 'clip'].includes(style.overflowY)
  return [
    {
      left: clipsX ? Math.max(bounds.left, groupBounds.left) : bounds.left,
      right: clipsX ? Math.min(bounds.right, groupBounds.right) : bounds.right,
      top: clipsY ? Math.max(bounds.top, groupBounds.top) : bounds.top,
      bottom: clipsY ? Math.min(bounds.bottom, groupBounds.bottom) : bounds.bottom,
    },
  ]
}

/** The border owns only paint. Captions keep their original hit areas and geometry. */
export function useSpaceCaptionBorder(regionRef: RefObject<HTMLDivElement | null>) {
  const refreshRef = useRef<(() => void) | null>(null)
  useLayoutEffect(() => {
    const region = regionRef.current
    if (!region) {
      return
    }
    const scope = region.closest('.workspace-canvas')
    let frame: number | null = null
    let captions: HTMLElement[] = []
    let appliedClip = ''
    const previousClip = region.style.getPropertyValue(CLIP_PROPERTY)
    const measure = () => {
      frame = null
      const bounds = region.getBoundingClientRect()
      const worldWidth = Number.parseFloat(region.style.width)
      if (!region.isConnected || bounds.width <= 0 || worldWidth <= 0) {
        return
      }
      const zoom = bounds.width / worldWidth
      const stroke = Number.parseFloat(
        getComputedStyle(region).getPropertyValue('--cove-space-stroke-scale'),
      )
      const visibleBounds = captions.flatMap(readVisibleBounds)
      const clip = buildSpaceCaptionBorderClip(
        resolveSpaceCaptionGaps(bounds, visibleBounds, zoom, Number.isFinite(stroke) ? stroke : 1),
      )
      if (clip !== appliedClip) {
        region.style.setProperty(CLIP_PROPERTY, clip)
        appliedClip = clip
      }
    }
    const schedule = () => {
      if (frame === null) {
        frame = requestAnimationFrame(measure)
      }
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(region)
    const refresh = () => {
      const nextCaptions = Array.from(
        region.querySelectorAll<HTMLElement>('[data-cove-space-caption]'),
      )
      if (
        nextCaptions.length === captions.length &&
        nextCaptions.every((caption, index) => caption === captions[index])
      ) {
        return
      }
      for (const caption of captions) {
        if (!nextCaptions.includes(caption)) {
          observer.unobserve(caption)
        }
      }
      for (const caption of nextCaptions) {
        if (!captions.includes(caption)) {
          observer.observe(caption)
        }
      }
      captions = nextCaptions
      if (frame !== null) {
        cancelAnimationFrame(frame)
      }
      measure()
    }
    const events = ['pointerover', 'pointerout', 'focusin', 'focusout'] as const
    for (const event of events) {
      region.addEventListener(event, schedule)
    }
    scope?.addEventListener(SPACE_VISUAL_SCALE_EVENT, schedule)
    refreshRef.current = refresh
    return () => {
      refreshRef.current = null
      observer.disconnect()
      if (frame !== null) {
        cancelAnimationFrame(frame)
      }
      for (const event of events) {
        region.removeEventListener(event, schedule)
      }
      scope?.removeEventListener(SPACE_VISUAL_SCALE_EVENT, schedule)
      if (region.style.getPropertyValue(CLIP_PROPERTY) === appliedClip) {
        if (previousClip) {
          region.style.setProperty(CLIP_PROPERTY, previousClip)
        } else {
          region.style.removeProperty(CLIP_PROPERTY)
        }
      }
    }
  }, [regionRef])

  // React owns caption replacement (rename, branch, locale); no subtree observer is needed.
  useLayoutEffect(() => {
    refreshRef.current?.()
  })
}
