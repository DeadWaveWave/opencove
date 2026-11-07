// @vitest-environment node
import { EventEmitter } from 'node:events'
import type { ServerResponse } from 'node:http'
import { expect, it } from 'vitest'
import { invokeCallerLifetime } from '../../../src/app/main/controlSurface/http/invokeCallerLifetime'
import { SessionGrantRegistry } from '../../../src/app/main/controlSurface/http/sessionGrantRegistry'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'

it.each(['disconnect', 'revoke', 'worker'] as const)(
  'propagates %s synchronously and cleans up lifetime listeners',
  action => {
    const response = new EventEmitter() as ServerResponse
    const shutdown = new AbortController()
    const grants = new SessionGrantRegistry(() => true)
    const { grant } = grants.issue({
      sessionId: 'caller',
      nodeId: 'terminal',
      spaceId: 'space',
      projectId: 'project',
    })
    const caller = invokeCallerLifetime(
      { signal: shutdown.signal } as ControlSurfaceContext,
      response,
      { kind: 'session-grant', grant },
      grants,
    )
    expect(caller.signal.aborted).toBe(false)
    if (action === 'disconnect') {
      response.emit('close')
    }
    if (action === 'revoke') {
      grants.revoke(grant.grantId)
    }
    if (action === 'worker') {
      shutdown.abort()
    }
    expect(caller.signal.aborted).toBe(true)
    expect(caller.assertActive).toThrow()
    caller.dispose()
    expect(response.listenerCount('close')).toBe(0)
  },
)
