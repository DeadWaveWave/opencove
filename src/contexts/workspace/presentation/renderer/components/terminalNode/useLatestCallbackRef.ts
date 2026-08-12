import { useEffect, useRef, type MutableRefObject } from 'react'

export function useLatestCallbackRef<T extends (...args: never[]) => unknown>(
  callback: T | undefined,
): MutableRefObject<T | undefined> {
  const callbackRef = useRef(callback)
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])
  return callbackRef
}
