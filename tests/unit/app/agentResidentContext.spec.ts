import {
  inMemoryClaudeHookChannel,
  inMemoryCodexHookChannel,
} from '../../support/inMemoryClaudeHookChannel'
import { describe, expect, it } from 'vitest'
import { residentChannel } from './agentResidentContext.helpers'

describe.each(['claude', 'codex'] as const)('%s resident context', provider => {
  it('replies before commit, reinjects only on SessionStart and reads the current setting', async () => {
    let enabled = true
    const f = await residentChannel(provider, async () => enabled)
    try {
      const reservation = await f.reserve()
      const before = await f.post(reservation)
      expect(before.status).toBe(200)
      expect(before.headers['content-type']).toBe('application/json')
      expect(JSON.parse(before.body)).toMatchObject({
        v: 1,
        context: expect.stringContaining('opencove whoami'),
      })
      expect(Buffer.byteLength(JSON.parse(before.body).context)).toBeLessThanOrEqual(2048)
      reservation.commit('pty')
      expect(await f.post(reservation)).toEqual(before)
      for (const event of ['UserPromptSubmit', 'PostToolUse', 'Stop']) {
        expect((await f.post(reservation, event)).status).toBe(204)
      }
      enabled = false
      expect((await f.post(reservation)).status).toBe(204)
      enabled = true
      expect((await f.post(reservation)).status).toBe(200)
      expect((await f.post(await f.reserve('none'))).status).toBe(204)
      expect((await f.post(reservation, 'SessionEnd')).status).toBe(204)
    } finally {
      await f.channel.dispose()
    }
  })

  it('never replies to displaced, stale or revoked launches', async () => {
    const f = await residentChannel(provider)
    try {
      const old = await f.reserve()
      old.commit('pty')
      const next = await f.reserve()
      let current = true
      next.commit('pty', {
        provider: provider === 'claude' ? 'claude-code' : 'codex',
        invocationId: 'new',
        generation: 2,
        isCurrent: () => current,
      })
      expect((await f.post(old)).status).toBe(204)
      expect((await f.post(next)).status).toBe(200)
      current = false
      expect((await f.post(next)).status).toBe(204)
      await next.dispose()
      expect((await f.post(next)).status).toBe(401)
    } finally {
      await f.channel.dispose()
    }
  })

  it('rechecks lifetime after the async setting read', async () => {
    let finish!: (value: boolean) => void
    const f = await residentChannel(
      provider,
      () =>
        new Promise(resolve => {
          finish = resolve
        }),
    )
    try {
      const reservation = await f.reserve()
      const response = f.post(reservation)
      await new Promise(resolve => setImmediate(resolve))
      await reservation.dispose()
      finish(true)
      expect((await response).status).toBe(204)
    } finally {
      await f.channel.dispose()
    }
  })
  it('silently skips a failed setting read and a semantically rejected observation', async () => {
    const f = await residentChannel(provider, async () => {
      throw new Error('unavailable')
    })
    try {
      const reservation = await f.reserve()
      expect((await f.post(reservation)).status).toBe(204)
      f.channel.setResidentContextEnabled!(async () => true)
      reservation.commit('rejected', {
        provider: provider === 'claude' ? 'claude-code' : 'codex',
        invocationId: 'rejected',
        generation: 1,
        isCurrent: () => true,
        observe: () => false,
      })
      expect((await f.post(reservation)).status).toBe(204)
    } finally {
      await f.channel.dispose()
    }
  })
  it('reinjects the same template on clear, resume and compact while ignoring stale lifecycle events', async () => {
    const f = (provider === 'claude' ? inMemoryClaudeHookChannel : inMemoryCodexHookChannel)()
    f.channel.setResidentContextEnabled!(async () => true)
    try {
      const reservation = await f.channel.reserveSpawn({ residentContext: 'canvas' })
      const token = reservation.env![`OPENCOVE_${provider.toUpperCase()}_HOOK_TOKEN`]!
      reservation.commit('lifecycle')
      const results = []
      const base = Date.now() - 10000
      for (const [index, source] of ['startup', 'clear', 'resume', 'compact'].entries()) {
        results.push(
          await f.postReply(token, 'SessionStart', String(base + index * 1000), {
            hook_event_name: 'SessionStart',
            source,
            session_id: source === 'startup' ? 'first' : 'next',
            cwd: '/tmp',
            transcript_path: '/tmp/missing',
          }),
        )
      }
      expect(results.map(result => result.status)).toEqual([200, 200, 200, 200])
      expect(new Set(results.map(result => result.body)).size).toBe(1)
      if (provider === 'claude') {
        expect(
          (
            await f.postReply(token, 'SessionStart', String(base), {
              hook_event_name: 'SessionStart',
              source: 'startup',
              session_id: 'first',
              cwd: '/tmp',
              transcript_path: '/tmp/missing',
            })
          ).status,
        ).toBe(204)
      }
    } finally {
      await f.channel.dispose()
    }
  })
})
