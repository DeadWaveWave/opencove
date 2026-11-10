// @vitest-environment node
import { expect, it } from 'vitest'
import { normalizeListPayload } from '../../../src/shared/contracts/controlSurface/operations/nodeQueriesNormalize'

it('preserves the legacy node-list shape when no creator filter is supplied', () => {
  expect(normalizeListPayload({ projectId: ' project ' })).toEqual({
    projectId: 'project',
    space: null,
    kind: null,
  })
  expect(normalizeListPayload(null)).toEqual({})
})

it.each([
  [' parent ', 'parent'],
  ['', null],
  [null, null],
])('normalizes an explicit creator filter %j', (value, normalized) => {
  expect(normalizeListPayload({ spawnedByNodeId: value })).toMatchObject({
    spawnedByNodeId: normalized,
  })
})
