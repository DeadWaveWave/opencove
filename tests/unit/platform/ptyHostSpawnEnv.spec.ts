import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolvePtyHostSpawnEnv } from '../../../src/platform/process/ptyHost/spawnEnv'
import { agentConfigurationEnv, parentAgentSessionEnv } from '../../support/parentAgentSessionEnv'

afterEach(() => vi.unstubAllEnvs())

describe('PTY spawn environment composition', () => {
  it('blocks caller-supplied parent session keys without mutating the caller environment', () => {
    const env = { ...parentAgentSessionEnv, ...agentConfigurationEnv }

    expect(resolvePtyHostSpawnEnv(env)).toStrictEqual(agentConfigurationEnv)
    expect(env).toStrictEqual({ ...parentAgentSessionEnv, ...agentConfigurationEnv })
  })

  it('also sanitizes inherited environments without mutating process.env', () => {
    for (const [key, value] of Object.entries(parentAgentSessionEnv)) {
      vi.stubEnv(key, value)
    }
    vi.stubEnv('CLAUDE_CODE_USE_BEDROCK', '1')
    vi.stubEnv('ANTHROPIC_BASE_URL', agentConfigurationEnv.ANTHROPIC_BASE_URL)

    const env = resolvePtyHostSpawnEnv()

    for (const [key, value] of Object.entries(parentAgentSessionEnv)) {
      expect(Object.hasOwn(env, key)).toBe(false)
      expect(process.env[key]).toBe(value)
    }
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBe('1')
    expect(env.ANTHROPIC_BASE_URL).toBe(agentConfigurationEnv.ANTHROPIC_BASE_URL)
  })
})
