import { spaceLocatorWire } from '../nodeWire'
import { normalizeFocusPayload } from '../nodeQueriesNormalize'
import * as z from 'zod'
import { defineOperation } from '../defineOperation'
export const canvasFocusOperation = defineOperation({
  id: 'canvas.focus',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Move the canvas viewport to a node or space',
  // Preserve legacy rejection diagnostics as well as the accept-domain.
  input: z.looseObject({
    target: z.discriminatedUnion('kind', [
      z.looseObject({ kind: z.literal('node'), nodeId: z.string() }),
      z.looseObject({ kind: z.literal('space'), locator: spaceLocatorWire }),
    ]),
  }),
  normalize: normalizeFocusPayload,
  legacyNormalize: normalizeFocusPayload,
  errors: [
    'node.not_found',
    'space.not_found',
    'space.ambiguous',
    'worker.unavailable',
    'worktree.git_unavailable',
    'worktree.not_a_git_repo',
    'worktree.list_worktrees_failed',
    'persistence.unavailable',
    'persistence.invalid_state',
    'persistence.io_failed',
  ],
})
export const canvasOperations = [canvasFocusOperation] as const
