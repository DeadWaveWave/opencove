import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@playwright/test'

async function readWorkspaceStateRaw(window: Page): Promise<unknown | null> {
  const raw = await window.evaluate(async () => {
    return await window.opencoveApi.persistence.readWorkspaceStateRaw()
  })

  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

async function readFirstHarnessAgentSessionId(window: Page): Promise<string | null> {
  return await window.evaluate(() => {
    const currentWindow = window as typeof window & {
      __opencoveWorkspaceCanvasTestApi?: {
        getFirstAgentSessionId: () => string | null
      }
    }

    return currentWindow.__opencoveWorkspaceCanvasTestApi?.getFirstAgentSessionId() ?? null
  })
}

async function readHarnessResumeSessionId(
  window: Page,
  ptySessionId: string,
): Promise<string | null> {
  return await window.evaluate(sessionId => {
    const currentWindow = window as typeof window & {
      __opencoveWorkspaceCanvasTestApi?: {
        getResumeSessionIdByPtySessionId: (ptySessionId: string) => string | null
      }
    }

    return (
      currentWindow.__opencoveWorkspaceCanvasTestApi?.getResumeSessionIdByPtySessionId(sessionId) ??
      null
    )
  }, ptySessionId)
}

async function readFirstPersistedAgentSessionId(window: Page): Promise<string | null> {
  const parsed = (await readWorkspaceStateRaw(window)) as {
    workspaces?: Array<{
      nodes?: Array<{
        kind?: string
        sessionId?: string
      }>
    }>
  } | null

  const nodes = parsed?.workspaces?.[0]?.nodes ?? []
  const agentNode = nodes.find(node => node.kind === 'agent')
  const sessionId = agentNode?.sessionId?.trim() ?? ''

  return sessionId.length > 0 ? sessionId : null
}

export async function installPtySessionCapture(window: Page): Promise<void> {
  await window.evaluate(() => {
    const captureWindow = window as typeof window & {
      __opencoveSeenSessionIds?: string[]
      __opencovePtyCaptureInstalled?: boolean
      __opencoveResumeSessionIdByPtySessionId?: Record<string, string | null>
    }

    if (captureWindow.__opencovePtyCaptureInstalled) {
      return
    }

    captureWindow.__opencoveSeenSessionIds = []
    captureWindow.__opencoveResumeSessionIdByPtySessionId = {}
    const seenSessionIds = captureWindow.__opencoveSeenSessionIds
    const rememberSessionId = (sessionId: string) => {
      if (!seenSessionIds.includes(sessionId)) {
        seenSessionIds.push(sessionId)
      }
    }

    window.opencoveApi.pty.onData(event => {
      rememberSessionId(event.sessionId)
    })
    window.opencoveApi.pty.onMetadata(event => {
      rememberSessionId(event.sessionId)
      captureWindow.__opencoveResumeSessionIdByPtySessionId![event.sessionId] =
        event.resumeSessionId
    })
    captureWindow.__opencovePtyCaptureInstalled = true
  })
}

async function readFirstObservedAgentSessionId(window: Page): Promise<string | null> {
  const harnessSessionId = await readFirstHarnessAgentSessionId(window)
  if (harnessSessionId) {
    return harnessSessionId
  }

  return await window.evaluate(() => {
    const captureWindow = window as typeof window & {
      __opencoveSeenSessionIds?: string[]
    }
    const sessionId = captureWindow.__opencoveSeenSessionIds?.[0]?.trim() ?? ''
    return sessionId.length > 0 ? sessionId : null
  })
}

export async function resolveFirstAgentSessionId(window: Page): Promise<string | null> {
  return (
    (await readFirstObservedAgentSessionId(window)) ??
    (await readFirstPersistedAgentSessionId(window))
  )
}

export async function readObservedResumeSessionId(
  window: Page,
  ptySessionId: string,
): Promise<string | null> {
  const harnessResumeSessionId = await readHarnessResumeSessionId(window, ptySessionId)
  if (harnessResumeSessionId) {
    return harnessResumeSessionId
  }

  return await window.evaluate(sessionId => {
    const captureWindow = window as typeof window & {
      __opencoveResumeSessionIdByPtySessionId?: Record<string, string | null>
    }
    const resumeSessionId = captureWindow.__opencoveResumeSessionIdByPtySessionId?.[sessionId]
    return typeof resumeSessionId === 'string' && resumeSessionId.trim().length > 0
      ? resumeSessionId
      : null
  }, ptySessionId)
}

export async function writeToPty(
  window: Page,
  payload: {
    sessionId: string
    data: string
  },
): Promise<void> {
  await window.evaluate(async ({ sessionId, data }) => {
    await window.opencoveApi.pty.write({ sessionId, data })
  }, payload)
}

function normalizeGeminiProjectDirectoryName(cwd: string): string {
  const name = path.basename(cwd).trim()
  return name.length > 0 ? name.replace(/[^a-zA-Z0-9._-]/g, '-') : 'workspace'
}

function createGeminiTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString()
}

function createGeminiMessage(
  type: 'user' | 'gemini' | 'info',
  content: unknown,
  timestampMs: number,
): {
  id: string
  timestamp: string
  type: 'user' | 'gemini' | 'info'
  content: unknown
} {
  return {
    id: `${type}-${timestampMs}`,
    timestamp: createGeminiTimestamp(timestampMs),
    type,
    content,
  }
}

export async function writeGeminiSessionFile({
  cwd,
  messages,
  sessionId,
  startedAtMs,
  summary,
  userDataDir,
}: {
  cwd: string
  messages: Array<{
    type: 'user' | 'gemini' | 'info'
    content: unknown
    timestampMs: number
  }>
  sessionId: string
  startedAtMs: number
  summary?: string
  userDataDir: string
}): Promise<string> {
  const projectDirectory = path.join(
    userDataDir,
    'home',
    '.gemini',
    'tmp',
    normalizeGeminiProjectDirectoryName(cwd),
  )
  const chatsDirectory = path.join(projectDirectory, 'chats')
  const sessionFilePath = path.join(chatsDirectory, `session-${sessionId}.json`)

  await mkdir(chatsDirectory, { recursive: true })
  await writeFile(path.join(projectDirectory, '.project_root'), cwd, 'utf8')
  await writeFile(
    sessionFilePath,
    JSON.stringify(
      {
        sessionId,
        projectHash: 'opencove-test-project-hash',
        startTime: createGeminiTimestamp(startedAtMs),
        lastUpdated: createGeminiTimestamp(messages.at(-1)?.timestampMs ?? startedAtMs),
        kind: 'main',
        messages: messages.map(message =>
          createGeminiMessage(message.type, message.content, message.timestampMs),
        ),
        ...(summary ? { summary } : {}),
      },
      null,
      2,
    ),
    'utf8',
  )

  return sessionFilePath
}
