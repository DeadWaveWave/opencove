import { useEffect, useRef, type RefObject } from 'react'
import {
  resolveDocumentNavigationRange,
  type DocumentNavigationIntent,
} from '../../../domain/documentNavigation'

type NavigationRange = NonNullable<ReturnType<typeof resolveDocumentNavigationRange>>

interface DocumentNavigationEditor {
  getModel: () => {
    getLineCount: () => number
    getLineMaxColumn: (lineNumber: number) => number
  } | null
  setSelection: (range: NavigationRange) => void
  revealRangeInCenter: (range: NavigationRange) => void
  focus: () => void
}

export interface DocumentNavigationProps {
  navigation?: DocumentNavigationIntent | null
  onNavigationApplied?: (requestId: number) => void
}

export function useDocumentNodeNavigation({
  ready,
  editorRef,
  navigation,
  onNavigationApplied,
}: DocumentNavigationProps & {
  ready: boolean
  editorRef: RefObject<DocumentNavigationEditor | null>
}): void {
  const appliedRequestRef = useRef<number | null>(null)
  useEffect(() => {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (
      !ready ||
      !editor ||
      !model ||
      !navigation ||
      appliedRequestRef.current === navigation.requestId
    ) {
      return
    }
    const range = resolveDocumentNavigationRange(navigation, model)
    if (range) {
      editor.setSelection(range)
      editor.revealRangeInCenter(range)
    }
    editor.focus()
    appliedRequestRef.current = navigation.requestId
    onNavigationApplied?.(navigation.requestId)
  }, [editorRef, navigation, onNavigationApplied, ready])
}
