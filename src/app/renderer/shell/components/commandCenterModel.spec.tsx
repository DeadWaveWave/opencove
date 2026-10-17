import { describe, expect, it } from 'vitest'
import { rankCommandSections, type CommandCenterSection } from './commandCenterModel'

function section(id: string, titles: string[], pinned = false): CommandCenterSection {
  return {
    id,
    label: id,
    pinned,
    items: titles.map(title => ({
      id: `${id}:${title}`,
      title,
      icon: <span />,
      onSelect: () => {},
    })),
  }
}

const sections = [
  section('needs-you', ['Review login flow'], true),
  section('windows', ['auth.ts', 'run tests later']),
  section('spaces', ['auth-refactor', 'release']),
  section('commands', ['Settings', 'Add Project']),
]

describe('rankCommandSections', () => {
  it('keeps the authored section order without a query', () => {
    expect(rankCommandSections(sections, '').map(item => item.id)).toEqual([
      'needs-you',
      'windows',
      'spaces',
      'commands',
    ])
  })

  it('leads with the section holding the best match, after pinned sections', () => {
    // "release" matches the Space as a prefix and the window only as scattered letters.
    const ranked = rankCommandSections(sections, 'rel')
    expect(ranked.map(item => item.id)).toEqual(['needs-you', 'spaces', 'windows'])
    expect(rankCommandSections(sections, 'log').map(item => item.id)[0]).toBe('needs-you')
  })

  it('keeps pinned sections first even when another section matches better', () => {
    const ranked = rankCommandSections(sections, 're')
    expect(ranked[0]?.id).toBe('needs-you')
  })
})
