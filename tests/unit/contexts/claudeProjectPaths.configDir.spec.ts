import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  encodeClaudeProjectPath,
  resolveClaudeConfigDirectoryCandidates,
  resolveClaudeProjectDirectoryCandidateGroups,
} from '../../../src/contexts/agent/infrastructure/ClaudeProjectPaths'

describe('Claude project paths with CLAUDE_CONFIG_DIR', () => {
  const home = resolve('/home/user')
  const cwd = resolve('/work/project')

  it('searches the configured directory before the default ~/.claude', () => {
    const config = resolve('/profiles/claude-work')
    expect(resolveClaudeConfigDirectoryCandidates([home], config)).toEqual([
      config,
      join(home, '.claude'),
    ])
    const [first] = resolveClaudeProjectDirectoryCandidateGroups(cwd, [home], config)
    expect(first[0]).toBe(join(config, 'projects', encodeClaudeProjectPath(cwd)))
    expect(first).toContain(join(home, '.claude', 'projects', encodeClaudeProjectPath(cwd)))
  })

  it.each([undefined, '', '   '])('falls back to ~/.claude when the variable is %j', value => {
    expect(resolveClaudeConfigDirectoryCandidates([home], value)).toEqual([join(home, '.claude')])
  })

  it('does not duplicate a configured directory that is the default one', () => {
    expect(resolveClaudeConfigDirectoryCandidates([home], join(home, '.claude'))).toEqual([
      join(home, '.claude'),
    ])
  })
})
