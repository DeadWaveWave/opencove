import { nodeSpaceLocator } from './nodeInputs'
import { withStrictInput } from './nodeInputValidation'
import { normalizeFocusPayload } from '../nodeQueriesNormalize'
import * as z from 'zod'
import { defineOperation } from '../defineOperation'
const focusInput = z.strictObject({
  target: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('node'), nodeId: z.string() }),
    z.strictObject({ kind: z.literal('space'), locator: nodeSpaceLocator }),
  ]),
})

export const canvasFocusOperation = defineOperation({
  id: 'canvas.focus',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Move the canvas viewport to a node or space',
  input: focusInput,
  normalize: normalizeFocusPayload,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: withStrictInput(focusInput, normalizeFocusPayload),
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
