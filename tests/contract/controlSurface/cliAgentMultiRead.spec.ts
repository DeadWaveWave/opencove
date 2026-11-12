// @vitest-environment node
import { expect, it } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerAgentRunStateHandlers } from '../../../src/app/main/controlSurface/handlers/agentRunStateHandlers'
import { createControlSurfaceHttpServerContext } from '../../../src/app/main/controlSurface/controlSurfaceHttpServerContext'
import type { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture } from '../../unit/app/cliIdentity.helpers'
import { continuationFixture } from '../../unit/contexts/claudeTurnContinuation.helpers'

it('composes independent ordinary Worker reads without a new batch wire operation', async () => {
  const f = identityFixture(),
    turns = continuationFixture(),
    surface = createControlSurface()
  try {
    turns.registry.bind('s', { nodeId: 'n' })
    turns.hook('UserPromptSubmit', 'prompt')
    turns.hook('Stop', 'prompt', 'Completed review')
    registerAgentRunStateHandlers(surface, {
      agentRuns: { registry: turns.registry },
    } as PtyStreamHub)
    f.values['node.list'] = {
      nodes: [
        { id: 'n', title: 'Reviewer', kind: 'agent' },
        { id: 'absent', title: 'Absent', kind: 'agent' },
      ],
    }
    const context = createControlSurfaceHttpServerContext({
      enableWebShell: false,
      ptyProtocolVersion: 1,
      replayWindowMaxBytes: 10,
    })
    const original = f.io.fetch
    f.io.fetch = async (url, init) => {
      const req = JSON.parse(String(init?.body))
      if (req.id === 'agent.finalMessage') {
        f.requests.push(req)
        return new Response(JSON.stringify(await surface.invoke(context, req)))
      }
      return original(url, init)
    }
    expect(
      await run(
        ['agent', 'read', '--node', 'Absent', '--node', 'Reviewer', '--node', 'Reviewer'],
        f.io,
      ),
    ).toBe(1)
    const output = JSON.parse(f.out())
    expect(output).toEqual([
      {
        node: 'Absent',
        ok: false,
        error: expect.objectContaining({ code: 'session.transcript_not_ready' }),
      },
      expect.objectContaining({
        node: 'Reviewer',
        ok: true,
        nodeId: 'n',
        turnId: 't1',
        message: 'Completed review',
        source: 'hook',
      }),
      expect.objectContaining({ node: 'Reviewer', ok: true, message: 'Completed review' }),
    ])
    expect(f.requests.filter(r => r.id === 'agent.finalMessage').map(r => r.payload)).toEqual([
      { nodeId: 'absent' },
      { nodeId: 'n' },
    ])
  } finally {
    turns.runtime.dispose()
  }
})
