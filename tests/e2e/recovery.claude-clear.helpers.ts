import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { expect, type Page, type TestInfo } from '@playwright/test'
import { lastUserBlocks, startMessagesApi } from './agent.prompt.real-claude.helpers'
import { readPersistedTerminalAgentNode } from './workspace-canvas.terminal-agent-overlay.helpers'
import { removePathWithRetry } from './workspace-canvas.helpers'

export const promptA = 'PROBE_PROMPT_A: reply with the configured mock response.'
export const promptC = 'PROMPT_C: reply with the configured mock response.'
export const promptB = 'PROBE_PROMPT_B: reply with the configured mock response.'
export const promptAfterRestart = 'PROBE_AFTER_RESTART: reply with the configured mock response.'

export interface Invocation {
  kind: 'invocation'
  at: string
  cwd: string
  pid: number
  argv: string[]
}

export interface Hook {
  kind: 'hook'
  at: string
  cwd: string
  input: {
    hook_event_name: string
    session_id: string
    source?: string
    prompt?: string
    last_assistant_message?: string
    transcript_path?: string
  }
}

export async function readRecords<T extends Invocation | Hook>(file: string): Promise<T[]> {
  const raw = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return ''
    }
    throw error
  })
  return raw
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as T)
}

export function launches(records: Invocation[]): Invocation[] {
  // Exclude --version / availability checks; keep all managed provider launches.
  return records.filter(record => record.argv.includes('--settings'))
}

export function launchIdentity(record: Invocation) {
  const resumeIndex = record.argv.indexOf('--resume')
  const newIndex = record.argv.indexOf('--session-id')
  return {
    mode: resumeIndex >= 0 ? 'resume' : 'new',
    resumeSessionId: resumeIndex >= 0 ? record.argv[resumeIndex + 1] : null,
    newSessionId: newIndex >= 0 ? record.argv[newIndex + 1] : null,
    ...record,
  }
}

export async function createClearHarness(testInfo: TestInfo) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'opencove-claude-clear-')))
  try {
    return await configureClearHarness(testInfo, root)
  } catch (error) {
    await removePathWithRetry(root)
    throw error
  }
}

async function configureClearHarness(testInfo: TestInfo, root: string) {
  const userDataDir = join(root, 'user-data')
  const home = join(userDataDir, 'home')
  const workspace = join(root, 'workspace')
  const config = join(root, 'claude-config')
  const bin = join(root, 'bin')
  const runtime = join(userDataDir, 'runtime')
  await Promise.all(
    [home, workspace, config, bin, runtime].map(dir => mkdir(dir, { recursive: true })),
  )
  await chmod(runtime, 0o700)
  const fixture = resolve('tests/e2e/fixtures/claude-clear-observation.mjs')
  const invocationLog = join(root, 'invocations.jsonl')
  const hookLog = join(root, 'hooks.jsonl')
  const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`
  const realCli = execFileSync('/bin/sh', ['-c', 'command -v claude'], {
    encoding: 'utf8',
    timeout: 10_000,
  }).trim()
  // PATH instrumentation preserves managed hook coverage (an executable override degrades it).
  // A shell exec preserves the real CLI's terminal, signals and argv; no fake provider is used.
  await writeFile(
    join(bin, 'claude'),
    `#!/bin/sh\n${quote(process.execPath)} ${quote(fixture)} invocation ${quote(invocationLog)} "$@" || exit $?\nexec ${quote(realCli)} "$@"\n`,
    { mode: 0o700 },
  )
  const profile = join(home, 'empty-profile')
  await writeFile(profile, '')
  const apiKey = 'opencove-local-diagnostic-not-a-real-key'
  await writeFile(
    join(config, '.claude.json'),
    JSON.stringify({
      hasCompletedOnboarding: true,
      hasSeenAutoDefaultNotice: true,
      hasSeenAutoModeEntryWarning: true,
      hasSeenAutoModeOutsideReadPrompt: true,
      customApiKeyResponses: { approved: [apiKey.slice(-20)], rejected: [] },
      projects: { [workspace]: { hasTrustDialogAccepted: true } },
    }),
  )
  // Claude merges these extra observation hooks with OpenCove's --settings hooks.
  // They emit no stdout, change no hook decisions, and leave the managed relay untouched.
  const command = [process.execPath, fixture, 'hook', hookLog].map(quote).join(' ')
  await writeFile(
    join(config, 'settings.json'),
    JSON.stringify({
      hooks: Object.fromEntries(
        ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Stop', 'StopFailure'].map(event => [
          event,
          [{ hooks: [{ type: 'command', command, timeout: 3 }] }],
        ]),
      ),
    }),
  )
  const api = await startMessagesApi({
    replyText: body => {
      const blocks = lastUserBlocks(body)
      if (blocks.includes(promptA)) {
        return 'REPLY_A'
      }
      if (blocks.includes(promptC)) {
        return 'REPLY_C'
      }
      if (blocks.includes(promptB)) {
        return 'REPLY_B'
      }
      return 'REPLY_AFTER_RESTART'
    },
  })
  const env = {
    NODE_ENV: 'test',
    HOME: home,
    USERPROFILE: home,
    ZDOTDIR: home,
    BASH_ENV: profile,
    ENV: profile,
    SHELL: '/bin/bash',
    PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_CACHE_HOME: join(home, '.cache'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_STATE_HOME: join(home, '.local', 'state'),
    XDG_RUNTIME_DIR: runtime,
    CODEX_HOME: join(root, 'codex-home'),
    CLAUDE_CONFIG_DIR: config,
    ANTHROPIC_API_KEY: apiKey,
    ANTHROPIC_AUTH_TOKEN: '',
    CLAUDE_CODE_OAUTH_TOKEN: '',
    ANTHROPIC_BASE_URL: api.url,
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    OPENCOVE_TEST_WORKSPACE: workspace,
    OPENCOVE_TEST_USE_REAL_AGENTS: '1',
    OPENCOVE_TEST_CLAUDE_HOOK_INSTALL_FAILURE: '0',
    OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
    OPENCOVE_WORKER_CLIENT: '1',
    OPENCOVE_EXPERIMENTAL_MANAGED_CLAUDE_BINDINGS: '1',
    OPENCOVE_TEST_CLAUDE_CLEAR_PROOF_HOLD: join(root, 'proof-hold'),
  }
  try {
    const version = execFileSync(realCli, ['--version'], {
      env: { ...process.env, ...env },
      timeout: 10_000,
    })
      .toString()
      .trim()
    expect(version).toMatch(/^2\.1\.321(?:\s|$)/)
    await testInfo.attach('real-cli-version', {
      body: version,
      contentType: 'text/plain',
    })
  } catch (error) {
    api.server.close()
    throw error
  }
  return { root, userDataDir, workspace, api, env, hookLog, invocationLog }
}

export async function typeTurn(window: Page, nodeId: string, text: string) {
  await window.locator(`[data-id="${nodeId}"] .xterm-helper-textarea`).click()
  await window.keyboard.type(text, { delay: 30 })
  await window.keyboard.press('Enter')
}

export async function waitForReply(hookLog: string, reply: string, from = 0) {
  await expect
    .poll(
      async () => {
        const hooks = await readRecords<Hook>(hookLog)
        return hooks
          .slice(from)
          .some(
            hook =>
              hook.input.hook_event_name === 'Stop' && hook.input.last_assistant_message === reply,
          )
      },
      { timeout: 60_000 },
    )
    .toBe(true)
}

export async function binding(window: Page, nodeId: string) {
  const node = await readPersistedTerminalAgentNode(window, nodeId)
  return {
    nodeId,
    present: node !== undefined,
    resumeSessionId: node?.agent?.resumeSessionId ?? null,
    resumeSessionIdVerified: node?.agent?.resumeSessionIdVerified ?? false,
  }
}

export async function attachScreen(testInfo: TestInfo, window: Page, stage: string) {
  await testInfo.attach(`${stage}-screen`, {
    body: await window.screenshot(),
    contentType: 'image/png',
  })
  await testInfo.attach(`${stage}-terminal`, {
    body: (await window.locator('.terminal-node').allTextContents()).join('\n'),
    contentType: 'text/plain',
  })
}
