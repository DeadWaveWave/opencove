import { describe, expect, it } from 'vitest'
import {
  FILESYSTEM_ENTRY_MIME,
  hasFilesystemEntryDragData,
  isFilesystemCanvasDropTarget,
  normalizeFilesystemEntryDragData,
  readFilesystemEntryDragData,
  setFilesystemEntryDragData,
  type FilesystemEntryDragData,
} from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/filesystemDrag'

const entry: FilesystemEntryDragData = {
  version: 1,
  uri: 'file:///remote/repo/docs/design',
  kind: 'directory',
  rootUri: 'file:///remote/repo',
  mountId: 'source-mount',
  sourceSpaceId: 'source-space',
}

describe('filesystem entry canvas drag', () => {
  it('round-trips only the OpenCove MIME with the source location intact', () => {
    const transfer = new DataTransfer()
    setFilesystemEntryDragData(transfer, entry)

    expect(transfer.types).toContain(FILESYSTEM_ENTRY_MIME)
    expect(transfer.effectAllowed).toBe('copyMove')
    expect(hasFilesystemEntryDragData(transfer)).toBe(true)
    expect(readFilesystemEntryDragData(transfer)).toEqual(entry)
  })

  it('does not interpret arbitrary text or malformed JSON as a file reference', () => {
    const transfer = new DataTransfer()
    transfer.setData('text/plain', JSON.stringify(entry))
    expect(hasFilesystemEntryDragData(transfer)).toBe(false)
    expect(readFilesystemEntryDragData(transfer)).toBeNull()
    transfer.setData(FILESYSTEM_ENTRY_MIME, '{invalid')
    expect(readFilesystemEntryDragData(transfer)).toBeNull()
  })

  it.each([
    { version: 2 },
    { kind: 'shortcut' },
    { uri: 'https://example.test/docs' },
    { uri: 'file:///remote/repo/%2e%2e/private' },
    { uri: 'file:///remote/repo/%2e%2e%2fprivate' },
    { uri: 'file://other/remote/repo/docs' },
    { rootUri: 'file:///remote/other' },
    { mountId: '' },
    { mountId: 7 },
    { mountId: undefined },
  ])('rejects invalid payload fields: %j', override => {
    expect(normalizeFilesystemEntryDragData({ ...entry, ...override })).toBeNull()
  })

  it('normalizes directory spelling without inferring a mount for explicit local sources', () => {
    expect(
      normalizeFilesystemEntryDragData({ ...entry, uri: `${entry.uri}/`, mountId: null }),
    ).toMatchObject({ uri: entry.uri, mountId: null, sourceSpaceId: 'source-space' })
  })

  it('leaves directory, node and editor drops to their owners', () => {
    for (const attributes of [
      'class="react-flow__node"',
      'class="workspace-space-explorer"',
      'data-cove-focus-scope="file-browser"',
      'contenteditable="true"',
    ]) {
      const root = document.createElement('div')
      root.innerHTML = `<div ${attributes}><span></span></div>`
      expect(isFilesystemCanvasDropTarget(root.querySelector('span'))).toBe(false)
    }
    expect(isFilesystemCanvasDropTarget(document.createElement('textarea'))).toBe(false)
    expect(isFilesystemCanvasDropTarget(document.createElement('div'))).toBe(true)
    expect(isFilesystemCanvasDropTarget(null)).toBe(false)
  })
})
