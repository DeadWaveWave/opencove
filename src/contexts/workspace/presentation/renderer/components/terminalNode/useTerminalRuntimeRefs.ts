import { useEffect, type MutableRefObject } from 'react'

export function useTerminalRuntimeRefs({
  isViewportInteractionActive,
  isViewportInteractionActiveRef,
  onCommandRun,
  onCommandRunRef,
  outputSchedulerRef,
  title,
  titleRef,
}: {
  isViewportInteractionActive: boolean
  isViewportInteractionActiveRef: MutableRefObject<boolean>
  onCommandRun: ((command: string) => void) | undefined
  onCommandRunRef: MutableRefObject<((command: string) => void) | undefined>
  outputSchedulerRef: MutableRefObject<{
    onViewportInteractionActiveChange: (active: boolean) => void
  } | null>
  title: string
  titleRef: MutableRefObject<string>
}): void {
  useEffect(() => {
    onCommandRunRef.current = onCommandRun
    titleRef.current = title
  }, [onCommandRun, onCommandRunRef, title, titleRef])

  useEffect(() => {
    isViewportInteractionActiveRef.current = isViewportInteractionActive
    outputSchedulerRef.current?.onViewportInteractionActiveChange(isViewportInteractionActive)
  }, [isViewportInteractionActive, isViewportInteractionActiveRef, outputSchedulerRef])
}
