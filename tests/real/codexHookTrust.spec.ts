import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { installManagedCodexHooks } from '../../src/app/main/controlSurface/agentHook/codexHookInstaller'
import {
  buildManagedCodexHookCommand,
  CODEX_HOOK_EVENTS,
} from '../../src/shared/runtime/codexHookRuntime'

type JsonRecord = Record<string, unknown>

interface ListedHook {
  key: string
  command: string
  currentHash: string
  trustStatus: string
}

const roots: string[] = []

afterAll(async () => {
  await Promise.all(
    roots.splice(0).map(async root => await rm(root, { recursive: true, force: true })),
  )
})

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function executablePath(): string {
  return process.env.OPENCOVE_REAL_CODEX_PATH?.trim() || '/opt/homebrew/bin/codex'
}

async function withAppServer<T>(
  executable: string,
  runtimeHome: string,
  run: (request: (method: string, params: JsonRecord) => Promise<JsonRecord>) => Promise<T>,
): Promise<T> {
  const child = spawn(executable, ['app-server'], {
    env: { ...process.env, CODEX_HOME: runtimeHome },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const pending = new Map<
    number,
    { resolve: (value: JsonRecord) => void; reject: (error: Error) => void }
  >()
  let nextId = 1
  let stdout = ''
  let stderr = ''
  child.stderr.on('data', chunk => {
    stderr = `${stderr}${String(chunk)}`.slice(-4000)
  })
  child.stdout.on('data', chunk => {
    stdout += String(chunk)
    const lines = stdout.split('\n')
    stdout = lines.pop() ?? ''
    for (const line of lines) {
      try {
        const message: unknown = JSON.parse(line)
        if (!isRecord(message) || typeof message.id !== 'number') {
          continue
        }
        const waiter = pending.get(message.id)
        if (!waiter) {
          continue
        }
        pending.delete(message.id)
        if (isRecord(message.error)) {
          waiter.reject(new Error(JSON.stringify(message.error)))
        } else if (isRecord(message.result)) {
          waiter.resolve(message.result)
        } else {
          waiter.reject(new Error(`Invalid RPC response: ${line}`))
        }
      } catch {
        // Diagnostics are not protocol responses.
      }
    }
  })
  child.once('exit', code => {
    const error = new Error(`app-server exited ${String(code)}: ${stderr}`)
    pending.forEach(waiter => waiter.reject(error))
    pending.clear()
  })
  const request = async (method: string, params: JsonRecord): Promise<JsonRecord> => {
    const id = nextId++
    return await new Promise<JsonRecord>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`${method} timed out: ${stderr}`))
      }, 10_000)
      pending.set(id, {
        resolve: value => {
          clearTimeout(timeout)
          resolve(value)
        },
        reject: error => {
          clearTimeout(timeout)
          reject(error)
        },
      })
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }
  try {
    await request('initialize', {
      clientInfo: { name: 'opencove_trust_test', title: 'OpenCove Trust Test', version: '1' },
    })
    child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`)
    return await run(request)
  } finally {
    child.stdin.end()
    child.kill('SIGTERM')
  }
}

function listedHooks(result: JsonRecord): ListedHook[] {
  if (!Array.isArray(result.data)) {
    return []
  }
  return result.data.flatMap(item => {
    if (!isRecord(item) || !Array.isArray(item.hooks)) {
      return []
    }
    return item.hooks.flatMap(hook => {
      if (
        !isRecord(hook) ||
        typeof hook.key !== 'string' ||
        typeof hook.command !== 'string' ||
        typeof hook.currentHash !== 'string' ||
        typeof hook.trustStatus !== 'string'
      ) {
        return []
      }
      return [hook as unknown as ListedHook]
    })
  })
}

function assertManagedTrust(hooks: ListedHook[], command: string, hooksPath: string): void {
  const managed = hooks.filter(hook => hook.command === command)
  expect(managed).toHaveLength(CODEX_HOOK_EVENTS.length)
  expect(managed.map(hook => hook.key.slice(0, hook.key.indexOf(':', 1)))).toEqual(
    Array.from({ length: CODEX_HOOK_EVENTS.length }, () => hooksPath),
  )
  expect(managed.every(hook => hook.trustStatus === 'trusted')).toBe(true)
}

describe('real managed hook trust', () => {
  it('grants, detects a broken grant, and repairs through the real app-server', async () => {
    const executable = executablePath()
    await access(executable)
    const home = await mkdtemp(join(tmpdir(), 'opencove-real-hook-trust-'))
    roots.push(home)
    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(join(home, '.codex', 'config.toml'), '')
    const runtimeHome = join(home, 'runtime-home')
    const scriptPath = join(home, '.opencove', 'agent-hooks', 'codex-hook.sh')
    const command = buildManagedCodexHookCommand(scriptPath)
    await mkdir(runtimeHome, { recursive: true })
    const normalizedHooksPath = await realpath(runtimeHome).then(path => join(path, 'hooks.json'))
    const install = async () =>
      await installManagedCodexHooks({
        homeDirectory: home,
        runtimeHomeDirectory: runtimeHome,
        scriptPath,
        codexExecutable: executable,
        trustGrantEntryPath: join(process.cwd(), 'src/app/cli/hooks/codex-trust-grant.mjs'),
      })

    await expect(install()).resolves.toMatchObject({ state: 'installed' })
    const trusted = await withAppServer(executable, runtimeHome, async request =>
      listedHooks(await request('hooks/list', { cwds: [runtimeHome] })),
    )
    assertManagedTrust(trusted, command, normalizedHooksPath)

    const first = trusted.find(hook => hook.command === command)
    expect(first).toBeDefined()
    await withAppServer(executable, runtimeHome, async request => {
      await request('config/batchWrite', {
        edits: [
          {
            keyPath: 'hooks.state',
            value: { [first!.key]: { trusted_hash: `sha256:${'0'.repeat(64)}` } },
            mergeStrategy: 'upsert',
          },
        ],
        reloadUserConfig: true,
      })
    })
    const broken = await withAppServer(executable, runtimeHome, async request =>
      listedHooks(await request('hooks/list', { cwds: [runtimeHome] })),
    )
    expect(() => assertManagedTrust(broken, command, normalizedHooksPath)).toThrow()
    const brokenStatus = broken.find(hook => hook.key === first!.key)?.trustStatus
    expect(brokenStatus).not.toBe('trusted')

    await expect(install()).resolves.toMatchObject({ state: 'installed' })
    const repaired = await withAppServer(executable, runtimeHome, async request =>
      listedHooks(await request('hooks/list', { cwds: [runtimeHome] })),
    )
    assertManagedTrust(repaired, command, normalizedHooksPath)
    const config = await readFile(join(runtimeHome, 'config.toml'), 'utf8')
    for (const hook of repaired.filter(item => item.command === command)) {
      expect(config).toContain(`[hooks.state."${hook.key}"]`)
      expect(config).toContain(`trusted_hash = "${hook.currentHash}"`)
    }
    process.stdout.write(
      `${JSON.stringify({
        redProof: { key: first!.key, trustStatus: brokenStatus },
        repaired: repaired
          .filter(item => item.command === command)
          .map(({ key, currentHash, trustStatus }) => ({ key, currentHash, trustStatus })),
      })}\n`,
    )
  })
})
