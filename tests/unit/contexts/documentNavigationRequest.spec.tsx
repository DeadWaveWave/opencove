import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDocumentNodeNavigation } from '../../../src/contexts/workspace/presentation/renderer/components/useDocumentNodeNavigation'

describe('DocumentNode navigation request', () => {
  function editor() {
    return {
      getModel: () => ({ getLineCount: () => 100, getLineMaxColumn: () => 80 }),
      setSelection: vi.fn(),
      revealRangeInCenter: vi.fn(),
      focus: vi.fn(),
    }
  }

  it('applies the newest requested location once after the editor becomes ready', () => {
    const target = editor()
    const onApplied = vi.fn()
    const ref = { current: target }
    const { rerender } = renderHook(
      ({ ready, line, requestId }) =>
        useDocumentNodeNavigation({
          ready,
          editorRef: ref,
          navigation: {
            requestId,
            uri: 'file:///repo/main.ts',
            mountId: 'remote',
            line,
            column: 7,
          },
          onNavigationApplied: onApplied,
        }),
      { initialProps: { ready: false, line: 1, requestId: 1 } },
    )
    expect(target.setSelection).not.toHaveBeenCalled()
    rerender({ ready: false, line: 30, requestId: 2 })
    rerender({ ready: true, line: 30, requestId: 2 })
    expect(target.setSelection).toHaveBeenCalledExactlyOnceWith({
      startLineNumber: 30,
      startColumn: 7,
      endLineNumber: 30,
      endColumn: 7,
    })
    expect(target.focus).toHaveBeenCalledOnce()
    expect(onApplied).toHaveBeenCalledExactlyOnceWith(2)
    rerender({ ready: true, line: 30, requestId: 2 })
    expect(target.setSelection).toHaveBeenCalledOnce()
  })

  it('never applies pending navigation after unmount', () => {
    const ref = { current: editor() }
    const { unmount } = renderHook(() =>
      useDocumentNodeNavigation({
        ready: false,
        editorRef: ref,
        navigation: { requestId: 1, uri: 'file:///repo/main.ts', mountId: null, line: 50 },
      }),
    )
    unmount()
    act(() => undefined)
    expect(ref.current.setSelection).not.toHaveBeenCalled()
  })
})
