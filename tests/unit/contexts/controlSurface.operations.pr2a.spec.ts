// @vitest-environment node
import { expect, it } from 'vitest'
import { registerOperation } from '../../../src/app/main/controlSurface/registerOperation'
import type { ControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { CONTROL_SURFACE_OPERATIONS } from '../../../src/shared/contracts/controlSurface/operations'
import * as node from '../../support/controlSurfaceLegacyOracles/nodeQueries'
import * as space from '../../support/controlSurfaceLegacyOracles/spaceQueries'
import * as worktree from '../../support/controlSurfaceLegacyOracles/worktree'
import { normalizeProjectListPayload } from '../../support/controlSurfaceLegacyOracles/project'
import { pr2aCorpus } from '../../support/controlSurfaceLegacyOracles/pr2aCorpus'
import { OpenCoveAppError } from '../../../src/shared/errors/appError'

const oracles: Record<string, (payload: unknown) => unknown> = {
  'canvas.focus': node.normalizeFocusPayload,
  'node.delete': node.normalizeDeletePayload,
  'node.get': node.normalizeGetPayload,
  'node.list': node.normalizeListPayload,
  'node.update': node.normalizeUpdatePayload,
  'project.list': normalizeProjectListPayload,
  'space.get': space.normalizeGetSpacePayload,
  'space.list': space.normalizeListSpacesPayload,
  'worktree.archive': worktree.normalizeArchiveWorktreePayload,
  'worktree.create': worktree.normalizeCreateWorktreePayload,
  'worktree.list': worktree.normalizeListWorktreesPayload,
}
const validators: Record<string, (payload: unknown) => unknown> = {}
const surface = {
  register(id, handler) {
    validators[id] = handler.validate
  },
} as ControlSurface
for (const operation of CONTROL_SURFACE_OPERATIONS) {
  if (!(operation.id in oracles)) {
    continue
  }
  if (operation.contract !== 'schema') {
    throw new Error(`Not migrated: ${operation.id}`)
  }
  // Narrow the heterogeneous registry only at this test's registration boundary.
  registerOperation(surface, operation as Parameters<typeof registerOperation>[1], {
    handle: () => undefined,
    defaultErrorCode: 'common.unexpected',
  })
}
function attempt(parse: (payload: unknown) => unknown, payload: unknown) {
  try {
    return { ok: true, value: parse(payload) }
  } catch (error) {
    if (!(error instanceof OpenCoveAppError)) {
      throw error
    }
    return { ok: false, error: error.toDescriptor() }
  }
}
for (const [id, cases] of Object.entries(pr2aCorpus)) {
  for (const [index, item] of cases.entries()) {
    it(`${id} ${index}: ${item.name}`, () => {
      if (id.startsWith('node.') || id === 'canvas.focus') {
        const op = CONTROL_SURFACE_OPERATIONS.find(candidate => candidate.id === id)!
        if (op.contract !== 'schema') {
          throw new Error(id)
        }
        const parsed = op.input.safeParse(item.payload)
        if (!parsed.success) {
          expect(() => validators[id](item.payload)).toThrow(
            expect.objectContaining({ code: 'common.invalid_input' }),
          )
        } else {
          expect(attempt(validators[id], item.payload)).toEqual(attempt(oracles[id], parsed.data))
        }
        return
      }
      expect(attempt(validators[id], item.payload)).toEqual(attempt(oracles[id], item.payload))
    })
  }
}
