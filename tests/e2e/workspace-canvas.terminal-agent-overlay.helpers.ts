import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, type Locator, type Page } from '@playwright/test'

const testAgentStubScript = path.resolve(__dirname, '../../scripts/test-agent-session-stub.mjs')

export async function createAgentCommandPath(options?: {
  invocationLogPath?: string
  scenario?: string
}): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'opencove-agent-overlay-'))
  await Promise.all(
    (
      [
        ['claude', 'claude-code'],
        ['codex', 'codex'],
      ] as const
    ).map(async ([command, provider]) => {
      const executablePath = path.join(directory, command)
      await writeFile(
        executablePath,
        `#!/bin/sh\n${
          options?.invocationLogPath
            ? `printf '${command} %s\\n' "$*" >> ${JSON.stringify(options.invocationLogPath)}\n`
            : ''
        }exec ${JSON.stringify(process.execPath)} ${JSON.stringify(
          testAgentStubScript,
        )} ${provider} "$PWD" new default-model "" ${
          options?.scenario ?? 'jsonl-overlay-lifecycle'
        }\n`,
        'utf8',
      )
      await chmod(executablePath, 0o755)
    }),
  )
  return directory
}

export async function readRuntimeSessionId(window: Page, nodeId: string): Promise<string | null> {
  return await window.evaluate(id => {
    return window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(id) ?? null
  }, nodeId)
}

export async function readPersistedTerminalAgentNode(window: Page, nodeId: string) {
  return await window.evaluate(async id => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    const parsed = raw
      ? (JSON.parse(raw) as {
          workspaces?: Array<{
            nodes?: Array<{
              id: string
              kind: string
              sessionId?: string | null
              terminalProviderHint?: string | null
              lastError?: string | null
              agent?: {
                provider?: string
                resumeSessionId?: string | null
                resumeSessionIdVerified?: boolean
              } | null
              agentOverlay?: unknown
              scrollback?: string | null
            }>
          }>
        })
      : null
    return parsed?.workspaces
      ?.flatMap(workspace => workspace.nodes ?? [])
      .find(node => node.id === id)
  }, nodeId)
}

export async function expectOverlayStubReady(
  terminal: Locator,
  provider: 'claude-code' | 'codex',
): Promise<void> {
  await expect
    .poll(async () => (await terminal.locator('.terminal-node__transcript').textContent()) ?? '')
    .toContain(`[opencove-test-overlay] ${provider} ready`)
}
