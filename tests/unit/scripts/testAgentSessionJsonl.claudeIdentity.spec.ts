// @vitest-environment node
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createClaudeSessionFile,
  resolveScenarioSessionFile,
} from '../../../scripts/test-agent-session-jsonl.mjs'

const assignedSessionId = '10000000-0000-4000-8000-000000000001'
const missingSessionId = '20000000-0000-4000-8000-000000000002'
const stubScriptPath = resolve(__dirname, '../../../scripts/test-agent-session-stub.mjs')

function startClaudeStub(cwd: string, temporaryHome: string, providerArgs: string[]) {
  const child = spawn(
    process.execPath,
    [
      stubScriptPath,
      'claude-code',
      cwd,
      'new',
      'default-model',
      '',
      'jsonl-stdin-submit-driven-turn',
      ...providerArgs,
    ],
    {
      cwd,
      env: {
        HOME: temporaryHome,
        USERPROFILE: temporaryHome,
        CLAUDE_CONFIG_DIR: join(temporaryHome, '.claude'),
        NODE_ENV: 'test',
        OPENCOVE_TEST_USE_REAL_AGENTS: '0',
        SystemRoot: process.env.SystemRoot,
      },
      stdio: 'pipe',
      timeout: 5_000,
      killSignal: 'SIGKILL',
    },
  )
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => (stdout += chunk.toString()))
  child.stderr.on('data', chunk => (stderr += chunk.toString()))
  child.on('error', error => (stderr += error.message))
  const closed = new Promise<number | null>(resolveExit => child.once('close', resolveExit))

  return {
    output: () => ({ stdout, stderr }),
    closed,
    stop: async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
      }
      await closed
    },
  }
}

describe('Claude test session JSONL identity', () => {
  let temporaryHome: string
  let cwd: string
  let projectDirectory: string

  beforeEach(async () => {
    temporaryHome = await mkdtemp(join(os.tmpdir(), 'opencove-claude-identity-'))
    vi.spyOn(os, 'homedir').mockReturnValue(temporaryHome)
    vi.stubEnv('HOME', temporaryHome)
    vi.stubEnv('USERPROFILE', temporaryHome)
    cwd = join(temporaryHome, 'workspace')
    await mkdir(cwd)
    projectDirectory = join(
      temporaryHome,
      '.claude',
      'projects',
      resolve(cwd).replace(/[^A-Za-z0-9]/g, '-'),
    )
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await rm(temporaryHome, { recursive: true, force: true })
  })

  it('creates the JSONL named after an explicitly assigned Claude session ID', async () => {
    const sessionFilePath = await createClaudeSessionFile(cwd, assignedSessionId)

    expect(sessionFilePath).toBe(join(projectDirectory, `${assignedSessionId}.jsonl`))
    expect(await readFile(sessionFilePath, 'utf8')).toBe('')
    expect(await readdir(projectDirectory)).toEqual([`${assignedSessionId}.jsonl`])
  })

  it('keeps the assigned Claude session ID when resolving a new managed scenario', async () => {
    const result = await resolveScenarioSessionFile({
      provider: 'claude-code',
      cwd,
      mode: 'new',
      resumeSessionId: assignedSessionId,
    })

    expect(result).toEqual({
      sessionFilePath: join(projectDirectory, `${assignedSessionId}.jsonl`),
      createdNewSession: true,
    })
    expect(await readdir(projectDirectory)).toEqual([`${assignedSessionId}.jsonl`])
  })

  it('still generates an ID for a plain terminal without an assigned session', async () => {
    const sessionFilePath = await createClaudeSessionFile(cwd)

    expect(dirname(sessionFilePath)).toBe(projectDirectory)
    expect(basename(sessionFilePath)).toMatch(/^.+\.jsonl$/)
    expect(await readFile(sessionFilePath, 'utf8')).toBe('')
  })

  it('resumes the exact existing Claude JSONL without replacing its content', async () => {
    const sessionFilePath = join(projectDirectory, `${assignedSessionId}.jsonl`)
    const existingContent = '{"type":"assistant","message":{"content":"fixture history"}}\n'
    await mkdir(projectDirectory, { recursive: true })
    await writeFile(sessionFilePath, existingContent, 'utf8')

    const result = await resolveScenarioSessionFile({
      provider: 'claude-code',
      cwd,
      mode: 'resume',
      resumeSessionId: assignedSessionId,
    })

    expect(result).toEqual({ sessionFilePath, createdNewSession: false })
    expect(await readFile(sessionFilePath, 'utf8')).toBe(existingContent)
    expect(await readdir(projectDirectory)).toEqual([`${assignedSessionId}.jsonl`])
  })

  it('rejects a missing explicit resume ID without creating or selecting another session', async () => {
    const unrelatedFile = join(projectDirectory, `${assignedSessionId}.jsonl`)
    await mkdir(projectDirectory, { recursive: true })
    await writeFile(unrelatedFile, 'unrelated fixture history\n', 'utf8')

    await expect(
      resolveScenarioSessionFile({
        provider: 'claude-code',
        cwd,
        mode: 'resume',
        resumeSessionId: missingSessionId,
      }),
    ).rejects.toThrow()

    expect(await readdir(projectDirectory)).toEqual([`${assignedSessionId}.jsonl`])
    expect(await readFile(unrelatedFile, 'utf8')).toBe('unrelated fixture history\n')
  })

  it.each([undefined, null, '', '   '])(
    'rejects resume without an assigned ID (%j) without creating session files',
    async resumeSessionId => {
      await expect(
        resolveScenarioSessionFile({
          provider: 'claude-code',
          cwd,
          mode: 'resume',
          resumeSessionId,
        }),
      ).rejects.toThrow()

      expect(await readdir(temporaryHome)).toEqual(['workspace'])
    },
  )

  it('passes --session-id through the real stub entrypoint to the created JSONL', async () => {
    const stub = startClaudeStub(cwd, temporaryHome, ['--session-id', assignedSessionId])

    try {
      await vi.waitFor(
        () =>
          expect(stub.output().stdout).toContain(
            `[opencove-test-claude-session] new\n${assignedSessionId}\n`,
          ),
        { timeout: 4_000, interval: 20 },
      )
      expect(stub.output().stderr).toBe('')
      expect(await readdir(projectDirectory)).toEqual([`${assignedSessionId}.jsonl`])
    } finally {
      await stub.stop()
    }
  })

  it('fails the real --resume entrypoint when its ID is missing without creating a replacement', async () => {
    const stub = startClaudeStub(cwd, temporaryHome, ['--resume', missingSessionId])

    try {
      expect(await stub.closed).toBe(1)
      expect(stub.output().stdout).toContain('[opencove-test-agent] claude-code resume')
      expect(stub.output().stderr).toContain('Claude fixture cannot resume')
      expect(await readdir(temporaryHome)).toEqual(['workspace'])
    } finally {
      await stub.stop()
    }
  })
})
