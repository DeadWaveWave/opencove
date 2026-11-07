import { describe, expect, it } from 'vitest'
import { stripParentAgentSessionEnv } from '../../../src/shared/runtime/stripParentAgentSessionEnv'
import { agentConfigurationEnv, parentAgentSessionEnv } from '../../support/parentAgentSessionEnv'

describe('stripParentAgentSessionEnv', () => {
  it('deletes exactly the ten parent-session keys in place and preserves configuration', () => {
    const env = { ...parentAgentSessionEnv, ...agentConfigurationEnv }

    stripParentAgentSessionEnv(env)

    expect(env).toStrictEqual(agentConfigurationEnv)
    for (const key of Object.keys(parentAgentSessionEnv)) {
      expect(Object.hasOwn(env, key)).toBe(false)
    }
  })

  it.each(['', '0', undefined])('removes listed keys even when their value is %s', value => {
    const env = Object.fromEntries(Object.keys(parentAgentSessionEnv).map(key => [key, value]))

    stripParentAgentSessionEnv(env)

    expect(env).toStrictEqual({})
  })

  it('is safe for clean environments and repeated startup sanitation', () => {
    const env = { ...agentConfigurationEnv }

    stripParentAgentSessionEnv({})
    stripParentAgentSessionEnv(env)
    stripParentAgentSessionEnv(env)

    expect(env).toStrictEqual(agentConfigurationEnv)
  })
})
