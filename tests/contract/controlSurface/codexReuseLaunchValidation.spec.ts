import { describe, expect, it } from 'vitest'
import { getControlSurfaceOperation } from '../../../src/shared/contracts/controlSurface/operations'

describe.each(['session.launchAgent', 'session.launchAgentInMount'])(
  '%s Codex reuse validation',
  id => {
    const operation = getControlSurfaceOperation(id)!
    if (operation.contract !== 'schema') {
      throw new Error('Expected a schema operation')
    }
    // Exercise normalization with unknown values as the IPC boundary does.
    const normalize = operation.normalize as (payload: unknown) => unknown
    const base = { cwd: '/tmp/repo', mountId: 'mount-a', prompt: '', provider: 'codex' }

    it.each([undefined, null, false, true])('preserves nullable boolean %j', value => {
      const wire = { ...base, codexReuseRunningAppServer: value }
      expect(operation.input.safeParse(wire).success).toBe(true)
      expect(normalize(wire)).toMatchObject({ codexReuseRunningAppServer: value ?? null })
    })

    it.each(['true', 1, {}, []])('rejects non-boolean %j at both boundaries', value => {
      const wire = { ...base, codexReuseRunningAppServer: value }
      expect(operation.input.safeParse(wire).success).toBe(false)
      expect(() => normalize(wire)).toThrow()
    })
  },
)
