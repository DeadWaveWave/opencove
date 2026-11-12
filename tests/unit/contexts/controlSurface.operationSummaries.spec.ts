// @vitest-environment node
import { expect, it } from 'vitest'
import { CONTROL_SURFACE_OPERATIONS } from '../../../src/shared/contracts/controlSurface/operations'

function words(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(
      word =>
        word && !['a', 'an', 'the', 'of', 'for', 'to', 'and', 'by', 'in', 'its'].includes(word),
    )
    .map(word => word.replace(/s$/, ''))
}

function hasUsefulSummary(id: string, summary: string): boolean {
  const idWords = new Set(words(id))
  return (
    summary === summary.trim() &&
    summary.length >= 12 &&
    summary.length <= 80 &&
    !/[\r\n]/.test(summary) &&
    !/^(Query|Perform)\s/i.test(summary) &&
    !summary.endsWith('.') &&
    words(summary).some(word => !idWords.has(word))
  )
}

it.each(CONTROL_SURFACE_OPERATIONS)('$id has a useful CLI summary', ({ id, summary }) => {
  expect(hasUsefulSummary(id, summary), `${id}: ${summary}`).toBe(true)
})

it.each([
  ['session.get', 'Query a launched session by its id'],
  ['node.delete', 'Perform deletion of a canvas node'],
  ['node.delete', 'Delete a canvas node.'],
  ['node.get', 'Read node'],
  ['session.get', 'Get the session'],
  ['session.get', 'Get the sessions'],
  ['session.get', 'Get its session'],
  ['gitWorktree.listBranches', 'List the git worktree branches'],
  ['session.launchAgent', 'Launch an agent session'],
])('rejects placeholder summary for %s: %s', (id, summary) => {
  expect(hasUsefulSummary(id, summary)).toBe(false)
})

it('accepts a summary that describes more than the operation id', () => {
  expect(hasUsefulSummary('session.get', 'Get a launched session by its id')).toBe(true)
})
