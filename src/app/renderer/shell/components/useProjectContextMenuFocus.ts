import type { RefObject } from 'react'
import { useCompactViewport } from '@app/renderer/components/useCompactViewport'
import { useMenuFocus } from '@app/renderer/components/useMenuFocus'

export function useProjectContextMenuFocus({
  menuRef,
  inputRef,
  isEditing,
  targetKey,
}: {
  menuRef: RefObject<HTMLDivElement | null>
  inputRef: RefObject<HTMLInputElement | null>
  isEditing: boolean
  targetKey: string
}): void {
  const compact = useCompactViewport()
  useMenuFocus({ menuRef, inputRef, isEditing, focusKey: targetKey, enabled: !compact })
}
