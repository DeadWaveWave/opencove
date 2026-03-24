import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/constants/ipc'

function createGeminiSessionPayload({
  sessionId,
  startedAtMs,
  messages,
}: {
  sessionId: string
  startedAtMs: number
  messages: Array<{
    type: 'user' | 'gemini' | 'info'
    timestampMs: number
    content: unknown
  }>
}): string {
  return JSON.stringify(
    {
      sessionId,
      projectHash: 'gemini-test-project',
      startTime: new Date(startedAtMs).toISOString(),
      lastUpdated:
        messages.length > 0
          ? new Date(messages[messages.length - 1]?.timestampMs ?? startedAtMs).toISOString()
          : new Date(startedAtMs).toISOString(),
      kind: 'main',
      messages: messages.map(message => ({
        id: `${message.type}-${message.timestampMs}`,
        type: message.type,
        timestamp: new Date(message.timestampMs).toISOString(),
        content: message.content,
      })),
    },
    null,
    2,
  )
}

async function waitForCondition(assertion: () => void, timeoutMs = 3_000): Promise<void> {
  try {
    assertion()
  } catch (error) {
    if (timeoutMs <= 0) {
      throw error
    }

    await new Promise(resolve => {
      setTimeout(resolve, 25)
    })
    await waitForCondition(assertion, timeoutMs - 25)
  }
}

describe('Gemini session binding', () => {
  const originalHome = process.env.HOME
  const originalUserProfile = process.env.USERPROFILE

  afterEach(() => {
    process.env.HOME = originalHome
    process.env.USERPROFILE = originalUserProfile
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('does not bind a new gemini launch to an older pre-existing real-turn session', async () => {
    const tempHome = await fs.mkdtemp(join(tmpdir(), 'cove-gemini-binding-home-'))
    const cwd = join(tempHome, 'workspace')
    const existingProjectDir = join(tempHome, '.gemini', 'tmp', 'existing')
    const newProjectDir = join(tempHome, '.gemini', 'tmp', 'new')
    const existingChatsDir = join(existingProjectDir, 'chats')
    const newChatsDir = join(newProjectDir, 'chats')
    const existingSessionPath = join(existingChatsDir, 'session-existing.json')
    const newSessionPath = join(newChatsDir, 'session-new.json')

    process.env.HOME = tempHome
    process.env.USERPROFILE = tempHome

    await fs.mkdir(cwd, { recursive: true })
    await fs.mkdir(existingChatsDir, { recursive: true })
    await fs.writeFile(join(existingProjectDir, '.project_root'), cwd, 'utf8')

    const startedAtMs = Date.now()
    const existingStartedAtMs = startedAtMs - 4_000
    await fs.writeFile(
      existingSessionPath,
      createGeminiSessionPayload({
        sessionId: 'existing-session',
        startedAtMs: existingStartedAtMs,
        messages: [
          {
            type: 'user',
            timestampMs: existingStartedAtMs + 100,
            content: [{ text: 'old prompt' }],
          },
          {
            type: 'gemini',
            timestampMs: existingStartedAtMs + 1_000,
            content: 'old reply',
          },
        ],
      }),
      'utf8',
    )

    const send = vi.fn()
    const content = {
      isDestroyed: () => false,
      getType: () => 'window',
      send,
      once: vi.fn(),
    }

    class MockPtyHostSupervisor {
      public write = vi.fn()
      public resize = vi.fn()
      public kill = vi.fn()
      public dispose = vi.fn()
      public crash = vi.fn()
      public spawn = vi.fn(async () => ({ sessionId: 'session-1' }))
      public onData(): void {}
      public onExit(): void {}
    }

    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn(() => '/tmp/cove-test-userdata'),
      },
      utilityProcess: {
        fork: vi.fn(),
      },
      webContents: {
        getAllWebContents: () => [content],
        fromId: () => content,
      },
    }))

    vi.doMock('../../../src/platform/process/ptyHost/supervisor', () => ({
      PtyHostSupervisor: MockPtyHostSupervisor,
    }))

    const { createPtyRuntime } =
      await import('../../../src/contexts/terminal/presentation/main-ipc/runtime')

    const runtime = createPtyRuntime()

    runtime.startSessionStateWatcher({
      sessionId: 'session-1',
      provider: 'gemini',
      cwd,
      launchMode: 'new',
      resumeSessionId: null,
      startedAtMs,
    })

    await new Promise(resolve => {
      setTimeout(resolve, 400)
    })

    expect(
      send.mock.calls.some(
        ([channel, payload]) =>
          channel === IPC_CHANNELS.ptySessionMetadata &&
          payload.sessionId === 'session-1' &&
          payload.resumeSessionId === 'existing-session',
      ),
    ).toBe(false)

    runtime.write('session-1', 'Return OK only.')
    runtime.write('session-1', '\r')

    await fs.mkdir(newChatsDir, { recursive: true })
    await fs.writeFile(join(newProjectDir, '.project_root'), cwd, 'utf8')
    await fs.writeFile(
      newSessionPath,
      createGeminiSessionPayload({
        sessionId: 'new-session',
        startedAtMs: startedAtMs + 500,
        messages: [
          {
            type: 'user',
            timestampMs: startedAtMs + 550,
            content: [{ text: 'Return OK only.' }],
          },
        ],
      }),
      'utf8',
    )

    await waitForCondition(() => {
      expect(
        send.mock.calls.some(
          ([channel, payload]) =>
            channel === IPC_CHANNELS.ptySessionMetadata &&
            payload.sessionId === 'session-1' &&
            payload.resumeSessionId === 'new-session',
        ),
      ).toBe(true)
    })

    await waitForCondition(() => {
      expect(
        send.mock.calls.some(
          ([channel, payload]) =>
            channel === IPC_CHANNELS.ptyState &&
            payload.sessionId === 'session-1' &&
            payload.state === 'working',
        ),
      ).toBe(true)
    })

    runtime.dispose()
    await fs.rm(tempHome, { recursive: true, force: true })
  })
})
