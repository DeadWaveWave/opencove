import { describe, expect, it } from 'vitest'
import { PROJECT_ACCENTS, resolveProjectAccent } from './projectAccent'

describe('resolveProjectAccent', () => {
  it('gives a project the same colour every time', () => {
    expect(resolveProjectAccent('workspace-a')).toBe(resolveProjectAccent('workspace-a'))
  })

  it('never uses the colours reserved for waiting, failure or neutral', () => {
    const ids = Array.from({ length: 64 }, (_, index) => `project-${index}`)
    for (const id of ids) {
      expect(['red', 'yellow', 'gray']).not.toContain(resolveProjectAccent(id))
    }
  })

  it('spreads projects across every accent', () => {
    const ids = Array.from({ length: 64 }, (_, index) => crypto.randomUUID() + index)
    expect(new Set(ids.map(resolveProjectAccent))).toEqual(new Set(PROJECT_ACCENTS))
  })
})
