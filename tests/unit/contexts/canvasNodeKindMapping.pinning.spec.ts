import { describe, expect, it } from 'vitest'
import { normalizeCanvasNodeKind } from '../../../src/app/main/controlSurface/handlers/spaceHandlers'
import { PERSISTED_WORKSPACE_NODE_KINDS } from '../../../src/shared/contracts/persistedAppState'

describe('canvas node kind mapping (pinned)', () => {
  it('maps every persisted node kind as before', () => {
    expect(
      Object.fromEntries(
        PERSISTED_WORKSPACE_NODE_KINDS.map(kind => [kind, normalizeCanvasNodeKind(kind)]),
      ),
    ).toEqual({
      terminal: 'terminal',
      agent: 'agent',
      task: 'task',
      note: 'note',
      role: 'unknown',
      image: 'image',
      document: 'document',
      folder: 'folder',
      website: 'website',
      plugin: 'unknown',
    })
  })

  it('maps anything that is not a persisted node kind to unknown', () => {
    for (const value of ['', 'Task', 'widget', null, undefined, 1, {}, ['task']]) {
      expect(normalizeCanvasNodeKind(value)).toBe('unknown')
    }
  })
})
