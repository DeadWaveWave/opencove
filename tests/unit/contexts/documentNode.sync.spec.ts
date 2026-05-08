import { describe, expect, it } from 'vitest'
import {
  isDocumentNodeFileStatEqual,
  resolveDocumentNodeExternalRefreshDecision,
} from '../../../src/contexts/workspace/presentation/renderer/components/DocumentNode.sync'

describe('DocumentNode sync', () => {
  const baseStat = {
    uri: 'file:///tmp/readme.md',
    kind: 'file',
    sizeBytes: 16,
    mtimeMs: 1234,
  }

  it('treats equivalent stats as unchanged', () => {
    expect(isDocumentNodeFileStatEqual(baseStat, { ...baseStat })).toBe(true)
    expect(
      resolveDocumentNodeExternalRefreshDecision({
        currentStat: baseStat,
        observedStat: { ...baseStat },
        conflictStat: null,
        isDirty: false,
      }),
    ).toBe('unchanged')
  })

  it('reloads clean documents and flags dirty ones as conflicts', () => {
    expect(
      resolveDocumentNodeExternalRefreshDecision({
        currentStat: baseStat,
        observedStat: { ...baseStat, mtimeMs: 2222 },
        conflictStat: null,
        isDirty: false,
      }),
    ).toBe('reload')

    expect(
      resolveDocumentNodeExternalRefreshDecision({
        currentStat: baseStat,
        observedStat: { ...baseStat, mtimeMs: 2222 },
        conflictStat: null,
        isDirty: true,
      }),
    ).toBe('conflict')
  })
})
