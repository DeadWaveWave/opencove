import { describe, expect, it } from 'vitest'
import {
  orderRootSpaces,
  reorderRootSpacesWithinPinGroup,
  setRootSpacePinned,
} from '@contexts/workspace/domain/workspaceSpacePinning'

type TestSpace = {
  id: string
  parentSpaceId?: string | null
  pinned?: boolean
  sortOrder?: number
}

function space(id: string, sortOrder: number, pinned = false): TestSpace {
  return { id, sortOrder, pinned }
}

describe('workspaceSpacePinning', () => {
  it('orders pinned root spaces before unpinned roots while preserving stable group order', () => {
    const spaces = [
      space('unpinned-b', 3),
      space('pinned-b', 2, true),
      space('unpinned-a', 1),
      space('pinned-a', 0, true),
      { ...space('child', 0, true), parentSpaceId: 'pinned-a' },
    ]

    expect(orderRootSpaces(spaces).map(candidate => candidate.id)).toEqual([
      'pinned-a',
      'pinned-b',
      'unpinned-a',
      'unpinned-b',
    ])
  })

  it('pins at the end of the pinned group and unpins at the start of the unpinned group', () => {
    const source = [space('pinned-a', 0, true), space('plain-a', 1), space('plain-b', 2)]

    const pinned = setRootSpacePinned(source, 'plain-b', true)
    expect(orderRootSpaces(pinned).map(candidate => [candidate.id, candidate.pinned])).toEqual([
      ['pinned-a', true],
      ['plain-b', true],
      ['plain-a', false],
    ])
    expect(orderRootSpaces(pinned).map(candidate => candidate.sortOrder)).toEqual([0, 1, 2])

    const unpinned = setRootSpacePinned(pinned, 'pinned-a', false)
    expect(orderRootSpaces(unpinned).map(candidate => [candidate.id, candidate.pinned])).toEqual([
      ['plain-b', true],
      ['pinned-a', false],
      ['plain-a', false],
    ])
    expect(orderRootSpaces(unpinned).map(candidate => candidate.sortOrder)).toEqual([0, 1, 2])
  })

  it('reorders only inside the same pin group and never mutates child spaces', () => {
    const child = { ...space('child', 9, true), parentSpaceId: 'pinned-a' }
    const source = [
      space('pinned-a', 0, true),
      space('pinned-b', 1, true),
      space('plain-a', 2),
      child,
    ]

    expect(reorderRootSpacesWithinPinGroup(source, 'pinned-a', 'plain-a')).toBe(source)

    const reordered = reorderRootSpacesWithinPinGroup(source, 'pinned-a', 'pinned-b')
    expect(orderRootSpaces(reordered).map(candidate => candidate.id)).toEqual([
      'pinned-b',
      'pinned-a',
      'plain-a',
    ])
    expect(reordered.find(candidate => candidate.id === 'child')).toBe(child)
  })
})
