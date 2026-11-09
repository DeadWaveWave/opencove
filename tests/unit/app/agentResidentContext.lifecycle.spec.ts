// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  inMemoryClaudeHookChannel,
  inMemoryCodexHookChannel,
} from '../../support/inMemoryClaudeHookChannel'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}

async function fixture(provider: 'claude' | 'codex') {
  const f = (provider === 'claude' ? inMemoryClaudeHookChannel : inMemoryCodexHookChannel)()
  const reservation = await f.channel.reserveSpawn({ residentContext: 'canvas' })
  const token = reservation.env![`OPENCOVE_${provider.toUpperCase()}_HOOK_TOKEN`]!
  const reading = deferred<void>()
  const setting = deferred<boolean>()
  let reads = 0
  f.channel.setResidentContextEnabled!(async () => {
    if (++reads === 1) {
      reading.resolve()
      return await setting.promise
    }
    return true
  })
  let at = Date.now() - 10000
  const send = (event = 'SessionStart', source = 'startup', id = 'conversation') =>
    f.postReply(token, event, String(++at), {
      hook_event_name: event,
      source,
      session_id: id,
      cwd: '/tmp',
      transcript_path: '/tmp/missing',
    })
  return { ...f, reservation, reading, setting, send }
}

describe.each(['claude', 'codex'] as const)(
  '%s resident context observation lifetime',
  provider => {
    it.each(['before', 'after'] as const)(
      'retires a pending startup reply when clear arrives %s commit',
      async timing => {
        const f = await fixture(provider)
        try {
          if (timing === 'after') {
            f.reservation.commit('pty')
          }
          const startup = f.send()
          await f.reading.promise
          expect((await f.send('SessionStart', 'clear')).status).toBe(200)
          if (timing === 'before') {
            f.reservation.commit('pty')
          }
          f.setting.resolve(true)
          expect(await startup).toEqual({ status: 204, body: '', headers: {} })
        } finally {
          f.setting.resolve(true)
          await f.channel.dispose()
        }
      },
    )

    it('retires a pending reply when the conversation ends during the setting read', async () => {
      const f = await fixture(provider)
      try {
        f.reservation.commit('pty')
        const startup = f.send()
        await f.reading.promise
        expect((await f.send('SessionEnd')).status).toBe(204)
        f.setting.resolve(true)
        expect((await startup).status).toBe(204)
      } finally {
        f.setting.resolve(true)
        await f.channel.dispose()
      }
    })

    it.each([false, true])(
      'preserves pre-commit replies only when commit accepts=%s',
      async accepted => {
        const f = await fixture(provider)
        try {
          const startup = f.send()
          await f.reading.promise
          f.reservation.commit('pty', {
            provider: provider === 'claude' ? 'claude-code' : 'codex',
            invocationId: 'invocation',
            generation: 1,
            isCurrent: () => true,
            observe: () => accepted,
          })
          f.setting.resolve(true)
          expect((await startup).status).toBe(accepted ? 200 : 204)
        } finally {
          f.setting.resolve(true)
          await f.channel.dispose()
        }
      },
    )

    it('does not invalidate startup context for ordinary turn telemetry', async () => {
      const f = await fixture(provider)
      try {
        f.reservation.commit('pty')
        const startup = f.send()
        await f.reading.promise
        expect((await f.send('UserPromptSubmit')).status).toBe(204)
        f.setting.resolve(true)
        expect((await startup).status).toBe(200)
      } finally {
        f.setting.resolve(true)
        await f.channel.dispose()
      }
    })
    it('does not deliver an older reply into a replacement provider conversation', async () => {
      const f = await fixture(provider)
      try {
        f.reservation.commit('pty')
        const startup = f.send()
        await f.reading.promise
        expect((await f.send('SessionStart', 'resume', 'replacement')).status).toBe(200)
        f.setting.resolve(true)
        expect((await startup).status).toBe(204)
      } finally {
        f.setting.resolve(true)
        await f.channel.dispose()
      }
    })
  },
)

it('does not revoke an accepted Claude reply for a semantically rejected stale clear', async () => {
  const f = await fixture('claude')
  try {
    f.reservation.commit('pty')
    const startup = f.send()
    await f.reading.promise
    const token = f.reservation.env!.OPENCOVE_CLAUDE_HOOK_TOKEN!
    expect(
      (
        await f.postReply(token, 'SessionStart', String(Date.now() - 20000), {
          hook_event_name: 'SessionStart',
          source: 'clear',
          session_id: 'retired',
          cwd: '/tmp',
          transcript_path: '/tmp/missing',
        })
      ).status,
    ).toBe(204)
    f.setting.resolve(true)
    expect((await startup).status).toBe(200)
  } finally {
    f.setting.resolve(true)
    await f.channel.dispose()
  }
})

it('invalidates an early Claude reply when the private lifecycle observer rejects it at commit', async () => {
  const f = await fixture('claude')
  const setting = deferred<boolean>()
  try {
    f.setting.resolve(true)
    expect((await f.send()).status).toBe(200)
    const reading = deferred<void>()
    f.channel.setResidentContextEnabled!(async () => {
      reading.resolve()
      return await setting.promise
    })
    const token = f.reservation.env!.OPENCOVE_CLAUDE_HOOK_TOKEN!
    const stale = f.postReply(token, 'SessionStart', String(Date.now() - 20000), {
      hook_event_name: 'SessionStart',
      source: 'clear',
      session_id: 'retired',
      cwd: '/tmp',
      transcript_path: '/tmp/missing',
    })
    await reading.promise
    // Both events were buffered. Replaying the first establishes a newer watermark,
    // so this older SessionStart is rejected even though the credential is still live.
    f.reservation.commit('pty')
    setting.resolve(true)
    expect(await stale).toEqual({ status: 204, body: '', headers: {} })
  } finally {
    setting.resolve(true)
    f.setting.resolve(true)
    await f.channel.dispose()
  }
})
