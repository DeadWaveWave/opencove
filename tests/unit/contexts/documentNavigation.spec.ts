import { describe, expect, it } from 'vitest'
import {
  resolveDocumentNavigationDestination,
  resolveDocumentNavigationRange,
} from '../../../src/contexts/workspace/domain/documentNavigation'

describe('document navigation', () => {
  const spaces = [
    { id: 'local', targetMountId: 'local-mount', nodeIds: ['terminal'] },
    { id: 'remote', targetMountId: 'remote-mount', nodeIds: [] },
  ]

  it('follows the terminal source mount after it moves into another Space', () => {
    expect(resolveDocumentNavigationDestination(spaces, 'terminal', 'remote-mount')).toEqual({
      spaceId: 'remote',
    })
  })

  it('does not fall back to a local Space when a remote destination is missing', () => {
    expect(resolveDocumentNavigationDestination(spaces, 'terminal', 'missing-mount')).toBeNull()
  })

  it('requires a choice when several other Spaces share the source mount', () => {
    expect(
      resolveDocumentNavigationDestination(
        [...spaces, { id: 'other-remote', targetMountId: 'remote-mount', nodeIds: [] }],
        'terminal',
        'remote-mount',
      ),
    ).toBeNull()
  })

  it('keeps an unmounted local source at workspace root when moved into a mounted Space', () => {
    expect(resolveDocumentNavigationDestination(spaces, 'terminal', null)).toEqual({
      spaceId: null,
    })
  })

  it('preserves line and column ranges and clamps them to the loaded document', () => {
    const model = {
      getLineCount: () => 3,
      getLineMaxColumn: (line: number) => (line === 3 ? 5 : 20),
    }
    expect(
      resolveDocumentNavigationRange({ line: 2, column: 4, lineEnd: 100, columnEnd: 99 }, model),
    ).toEqual({ startLineNumber: 2, startColumn: 4, endLineNumber: 3, endColumn: 5 })
  })

  it('does not interpret missing or invalid line metadata as a jump', () => {
    const model = { getLineCount: () => 3, getLineMaxColumn: () => 20 }
    expect(resolveDocumentNavigationRange({}, model)).toBeNull()
    expect(resolveDocumentNavigationRange({ line: Number.NaN }, model)).toBeNull()
  })
})
