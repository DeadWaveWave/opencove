import { describe, expect, it } from 'vitest'
import { toFileUri } from '../../../../src/contexts/filesystem/domain/fileUri'
import { resolveEntryMovePlan } from '../../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceSpaceExplorerOverlay.operations'

describe('resolveEntryMovePlan', () => {
  it('treats dropping an entry back into its current parent directory as a no-op', () => {
    const entry = {
      uri: toFileUri('/tmp/project/drag-folder'),
      name: 'drag-folder',
      kind: 'directory' as const,
    }

    expect(
      resolveEntryMovePlan({
        entry,
        targetDirectoryUri: toFileUri('/tmp/project'),
      }),
    ).toEqual({ kind: 'noop' })
  })

  it('treats dropping a directory onto itself as a no-op', () => {
    const entry = {
      uri: toFileUri('/tmp/project/drag-folder'),
      name: 'drag-folder',
      kind: 'directory' as const,
    }

    expect(
      resolveEntryMovePlan({
        entry,
        targetDirectoryUri: entry.uri,
      }),
    ).toEqual({ kind: 'noop' })
  })

  it('rejects moving a directory into one of its descendants', () => {
    const entry = {
      uri: toFileUri('/tmp/project/drag-folder'),
      name: 'drag-folder',
      kind: 'directory' as const,
    }

    expect(
      resolveEntryMovePlan({
        entry,
        targetDirectoryUri: toFileUri('/tmp/project/drag-folder/child-dir'),
      }),
    ).toEqual({ kind: 'invalid-descendant' })
  })

  it('returns a target uri for valid moves', () => {
    const entry = {
      uri: toFileUri('/tmp/project/drag-folder'),
      name: 'drag-folder',
      kind: 'directory' as const,
    }

    expect(
      resolveEntryMovePlan({
        entry,
        targetDirectoryUri: toFileUri('/tmp/project/nested'),
      }),
    ).toEqual({
      kind: 'move',
      targetUri: toFileUri('/tmp/project/nested/drag-folder'),
    })
  })
})
