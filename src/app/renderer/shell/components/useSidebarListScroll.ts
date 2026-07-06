import { useCallback, useLayoutEffect, useRef, useState, type UIEventHandler } from 'react'

export type SidebarScrollFade = 'none' | 'top' | 'bottom' | 'both'

function resolveSidebarScrollFade(element: HTMLDivElement): SidebarScrollFade {
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
  if (maxScrollTop <= 1) {
    return 'none'
  }

  const scrollTop = Math.min(Math.max(element.scrollTop, 0), maxScrollTop)
  const hasContentAbove = scrollTop > 1
  const hasContentBelow = maxScrollTop - scrollTop > 1

  if (hasContentAbove && hasContentBelow) {
    return 'both'
  }

  if (hasContentAbove) {
    return 'top'
  }

  return hasContentBelow ? 'bottom' : 'none'
}

function resolveSidebarScrollRatio(element: HTMLDivElement): number {
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
  if (maxScrollTop <= 1) {
    return 0
  }

  return Math.min(Math.max(element.scrollTop / maxScrollTop, 0), 1)
}

export function useSidebarListScroll(): {
  scrollFade: SidebarScrollFade
  setListRef: (element: HTMLDivElement | null) => void
  handleListScroll: UIEventHandler<HTMLDivElement>
} {
  const [scrollFade, setScrollFade] = useState<SidebarScrollFade>('none')
  const listRef = useRef<HTMLDivElement | null>(null)
  const scrollRatioRef = useRef(0)

  const updateScrollFade = useCallback((element: HTMLDivElement): void => {
    const nextFade = resolveSidebarScrollFade(element)
    setScrollFade(previous => (previous === nextFade ? previous : nextFade))
  }, [])

  const restoreScroll = useCallback(
    (element: HTMLDivElement): void => {
      const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
      element.scrollTop = maxScrollTop <= 1 ? 0 : maxScrollTop * scrollRatioRef.current
      updateScrollFade(element)
    },
    [updateScrollFade],
  )

  const setListRef = useCallback(
    (element: HTMLDivElement | null): void => {
      listRef.current = element
      if (element) {
        restoreScroll(element)
      }
    },
    [restoreScroll],
  )

  const handleListScroll = useCallback<UIEventHandler<HTMLDivElement>>(
    event => {
      const element = event.currentTarget
      scrollRatioRef.current = resolveSidebarScrollRatio(element)
      updateScrollFade(element)
    },
    [updateScrollFade],
  )

  useLayoutEffect(() => {
    if (listRef.current) {
      restoreScroll(listRef.current)
    }
  })

  return { scrollFade, setListRef, handleListScroll }
}
