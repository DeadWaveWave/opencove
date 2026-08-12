import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionTurnStateWatcher } from '../../src/contexts/agent/infrastructure/watchers/SessionTurnStateWatcher'

const stubScriptPath = resolve(__dirname, '../../scripts/test-agent-session-stub.mjs')
const overlayAdvanceSentinel = '<test-overlay-advance>'
const interruptByte = 0x03
const legacyTransitionWindowMs = 2_500

const childProcesses: ChildProcessWithoutNullStreams[] = []
const temporaryDirectories: string[] = []

function delay(ms: number): Promise<void> {
  return new Promise(resolveDelay => {
    setTimeout(resolveDelay, ms)
  })
}

async function waitUntil<T>(readValue: () => Promise<T | null>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop -- bounded polling waits for child-process IO
    const value = await readValue()
    if (value !== null) {
      return value
    }
    // eslint-disable-next-line no-await-in-loop -- bounded polling waits for child-process IO
    await delay(25)
  }

  throw new Error(`Timed out after ${timeoutMs}ms.`)
}

async function findJsonlFile(directoryPath: string): Promise<string | null> {
  const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => [])

  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name)
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      return entryPath
    }
    if (entry.isDirectory()) {
      // eslint-disable-next-line no-await-in-loop -- the temporary tree contains one session file
      const nestedFile = await findJsonlFile(entryPath)
      if (nestedFile) {
        return nestedFile
      }
    }
  }

  return null
}

async function startOverlayStub(provider: 'claude-code' | 'codex') {
  const temporaryHome = await mkdtemp(join(tmpdir(), 'opencove-overlay-stub-home-'))
  const workspace = await mkdtemp(join(tmpdir(), 'opencove-overlay-stub-workspace-'))
  temporaryDirectories.push(temporaryHome, workspace)

  const child = spawn(
    process.execPath,
    [stubScriptPath, provider, workspace, 'new', 'default-model', '', 'jsonl-overlay-lifecycle'],
    {
      env: {
        ...process.env,
        HOME: temporaryHome,
        USERPROFILE: temporaryHome,
      },
      stdio: 'pipe',
    },
  )
  childProcesses.push(child)

  const sessionFilePath = await waitUntil(async () => {
    const filePath = await findJsonlFile(temporaryHome)
    if (!filePath) {
      return null
    }
    const contents = await readFile(filePath, 'utf8')
    const hasWorkingRecord =
      provider === 'claude-code'
        ? contents.includes('"thinking"')
        : contents.includes('"task_started"')
    return hasWorkingRecord ? filePath : null
  })

  return { child, sessionFilePath }
}

async function waitForLatestState(
  states: string[],
  expectedState: 'working' | 'standby',
): Promise<void> {
  await waitUntil(async () => (states.at(-1) === expectedState ? true : null))
}

afterEach(async () => {
  for (const child of childProcesses.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
    }
  }
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async directoryPath => await rm(directoryPath, { recursive: true, force: true })),
  )
})

describe('agent session stub overlay lifecycle', () => {
  it.each(['claude-code', 'codex'] as const)(
    'keeps %s working until a delayed watcher explicitly advances it',
    async provider => {
      const { child, sessionFilePath } = await startOverlayStub(provider)

      // Attach later than the former timer window. A timer-driven stub has already
      // written standby by this point, so an offset-zero watcher would skip Working.
      await delay(legacyTransitionWindowMs + 750)

      const states: string[] = []
      const watcher = new SessionTurnStateWatcher({
        provider,
        sessionId: `delayed-${provider}`,
        filePath: sessionFilePath,
        onState: (_sessionId, state) => states.push(state),
      })
      watcher.start()

      try {
        await waitUntil(async () => (states.length > 0 ? true : null))
        await delay(100)
        expect(states).toEqual(['working'])

        child.stdin.write(overlayAdvanceSentinel)
        await waitForLatestState(states, 'standby')
        expect(states).toEqual(['working', 'standby'])

        child.stdin.write(Buffer.from([interruptByte]))
      } finally {
        watcher.dispose()
      }
    },
    20_000,
  )
})
