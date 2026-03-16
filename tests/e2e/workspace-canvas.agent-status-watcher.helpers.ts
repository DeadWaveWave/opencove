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
    }

    if (captureWindow.__opencovePtyCaptureInstalled) {
      return
    }

    captureWindow.__opencoveSeenSessionIds = []
    const seenSessionIds = captureWindow.__opencoveSeenSessionIds
    window.opencoveApi.pty.onData(event => {
      if (!seenSessionIds.includes(event.sessionId)) {
        seenSessionIds.push(event.sessionId)
      }
    })
    captureWindow.__opencovePtyCaptureInstalled = true
  })
}

async function readFirstObservedAgentSessionId(window: Page): Promise<string | null> {
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
