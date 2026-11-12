import { afterEach, describe, expect, it } from 'vitest'
import { configureWorkerEnvironment } from '../../../src/app/worker/environment'
import { agentConfigurationEnv, parentAgentSessionEnv } from '../../support/parentAgentSessionEnv'

const originalEnv = process.env
afterEach(() => {
  process.env = originalEnv
})

describe('Worker entry environment setup', () => {
  it('synchronously sanitizes its own process environment before startup work', () => {
    process.env = { ...parentAgentSessionEnv, ...agentConfigurationEnv }
    const workerEnv = process.env

    configureWorkerEnvironment()

    expect(process.env).toBe(workerEnv)
    expect(process.env).toStrictEqual(agentConfigurationEnv)
  })
})
