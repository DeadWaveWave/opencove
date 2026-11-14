import { describe, expect, it } from 'vitest'
import { buildControlSurfaceAgentLaunchTitle } from '../../../src/contexts/workspace/domain/controlSurfaceAgentLaunchTitle'

describe('control-surface agent launch title', () => {
  it.each([null, ''])('uses the generic title when the model is %j', model => {
    expect(buildControlSurfaceAgentLaunchTitle('codex', model)).toBe('Agent')
  })

  it('preserves provider IDs and model text in the launch title', () => {
    expect(buildControlSurfaceAgentLaunchTitle('codex', 'gpt-5.2-codex')).toBe(
      'codex gpt-5.2-codex',
    )
    expect(buildControlSurfaceAgentLaunchTitle('claude-code', ' sonnet ')).toBe(
      'claude-code  sonnet ',
    )
  })
})
