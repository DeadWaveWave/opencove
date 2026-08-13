import { spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  computeCodexHookTrustedHash,
  computeCodexHookTrustKey,
} from '../../../../shared/runtime/codexHookTrust'

type JsonRecord = Record<string, unknown>

export interface ManagedCodexTrustEntry {
  eventName: string
  command: string
  timeoutSeconds: number
  sourcePath: string
}

export interface CodexHookTrustGrantResult {
  lane: 'rpc' | 'fallback'
  trustedHashes: Record<string, string>
  detail: string | null
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

async function writeAtomic(path: string, contents: string, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporaryPath = `${path}.opencove-${process.pid}-${randomBytes(5).toString('hex')}.tmp`
  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8', mode })
    await chmod(temporaryPath, mode)
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

function parseRpcResponse(stdout: string, id: number): JsonRecord | null {
  for (const line of stdout.split(/\r?\n/u)) {
    if (!line.trim()) {
      continue
    }
    try {
      const parsed: unknown = JSON.parse(line)
      if (isRecord(parsed) && parsed.id === id && isRecord(parsed.result)) {
        return parsed.result
      }
    } catch {
      // Ignore diagnostics and keep looking for the requested response.
    }
  }
  return null
}

function runRpcSession(input: {
  executable: string
  runtimeHome: string
  messages: JsonRecord[]
}): { stdout: string; error: string | null } {
  const result = spawnSync(input.executable, ['app-server'], {
    env: { ...process.env, CODEX_HOME: input.runtimeHome },
    input: `${input.messages.map(message => JSON.stringify(message)).join('\n')}\n`,
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  })
  if (result.error || result.status !== 0) {
    return {
      stdout: result.stdout ?? '',
      error:
        result.error?.message ??
        (typeof result.stderr === 'string' && result.stderr.trim()
          ? result.stderr.trim().slice(0, 500)
          : `app-server exited ${String(result.status)}`),
    }
  }
  return { stdout: result.stdout ?? '', error: null }
}

function initializeMessages(): JsonRecord[] {
  return [
    {
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'opencove_desktop', title: 'OpenCove', version: '0.0.0' } },
    },
    { method: 'initialized', params: {} },
  ]
}

function hooksFromListResult(result: JsonRecord | null): JsonRecord[] {
  if (!result || !Array.isArray(result.data)) {
    return []
  }
  return result.data.flatMap(item =>
    isRecord(item) && Array.isArray(item.hooks) ? item.hooks : [],
  )
}

function expectedKeys(entries: readonly ManagedCodexTrustEntry[]): Set<string> {
  return new Set(
    entries.map(entry =>
      computeCodexHookTrustKey({ sourcePath: entry.sourcePath, eventName: entry.eventName }),
    ),
  )
}

function resolveManagedHooks(
  hooks: JsonRecord[],
  entries: readonly ManagedCodexTrustEntry[],
): JsonRecord[] {
  const keys = expectedKeys(entries)
  const commands = new Set(entries.map(entry => entry.command))
  return hooks.filter(
    hook =>
      typeof hook.key === 'string' &&
      keys.has(hook.key) &&
      typeof hook.command === 'string' &&
      commands.has(hook.command),
  )
}

function hashesFromHooks(hooks: readonly JsonRecord[]): Record<string, string> {
  return Object.fromEntries(
    hooks.flatMap(hook =>
      typeof hook.key === 'string' && typeof hook.currentHash === 'string'
        ? [[hook.key, hook.currentHash]]
        : [],
    ),
  )
}

function escapeTomlKey(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function appendFallbackTrust(raw: string, hashes: Record<string, string>): string {
  let next = raw.trimEnd()
  if (!/^\[hooks\.state\]\s*$/mu.test(next)) {
    next += `${next ? '\n\n' : ''}[hooks.state]`
  }
  for (const [key, trustedHash] of Object.entries(hashes)) {
    const header = `[hooks.state."${escapeTomlKey(key)}"]`
    const escapedHeader = header.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const sectionPattern = new RegExp(`(?:^|\\n)${escapedHeader}\\n[\\s\\S]*?(?=\\n\\[|$)`, 'u')
    next = next.replace(sectionPattern, '')
    next += `\n\n${header}\nenabled = true\ntrusted_hash = "${trustedHash}"`
  }
  return `${next.trim()}\n`
}

async function restoreSnapshot(path: string, snapshot: string | null): Promise<void> {
  if (snapshot === null) {
    await rm(path, { force: true })
    return
  }
  await writeAtomic(path, snapshot)
}

async function executableFingerprint(executable: string): Promise<JsonRecord | null> {
  try {
    const resolved = executable.includes('/')
      ? executable
      : (spawnSync('which', [executable], { encoding: 'utf8' }).stdout ?? '').trim()
    if (!resolved) {
      return null
    }
    const info = statSync(resolved)
    return { path: resolved, size: info.size, mtimeMs: Math.floor(info.mtimeMs) }
  } catch {
    return null
  }
}

async function writeLedger(
  runtimeHome: string,
  executable: string,
  hashes: Record<string, string>,
): Promise<void> {
  const fingerprint = await executableFingerprint(executable)
  await writeAtomic(
    join(runtimeHome, 'trust-grant-ledger.json'),
    `${JSON.stringify({ version: 1, executable: fingerprint, grants: hashes }, null, 2)}\n`,
  )
}

export async function grantManagedCodexHookTrust(options: {
  runtimeHome: string
  executable: string
  entries: readonly ManagedCodexTrustEntry[]
  entryPath?: string
}): Promise<CodexHookTrustGrantResult> {
  const configPath = join(options.runtimeHome, 'config.toml')
  const snapshot = await readOptional(configPath).catch(() => null)
  try {
    if (options.entryPath) {
      const bridgeResult = spawnSync(process.execPath, [options.entryPath], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        input: JSON.stringify({
          executable: options.executable,
          runtimeHome: options.runtimeHome,
          entries: options.entries.map(entry => ({
            ...entry,
            key: computeCodexHookTrustKey({
              sourcePath: entry.sourcePath,
              eventName: entry.eventName,
            }),
          })),
        }),
        encoding: 'utf8',
        timeout: 20_000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      })
      const line = (bridgeResult.stdout ?? '')
        .split(/\r?\n/u)
        .map(value => value.trim())
        .find(Boolean)
      const envelope: unknown = line ? JSON.parse(line) : null
      if (
        bridgeResult.error ||
        bridgeResult.status !== 0 ||
        !isRecord(envelope) ||
        envelope.ok !== true ||
        !isRecord(envelope.trustedHashes)
      ) {
        throw new Error(
          bridgeResult.error?.message ??
            (isRecord(envelope) && typeof envelope.error === 'string'
              ? envelope.error
              : 'Trust grant entry failed.'),
        )
      }
      const trustedHashes = Object.fromEntries(
        Object.entries(envelope.trustedHashes).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
      const trustedHashKeys = new Set(Object.keys(trustedHashes))
      const expectedTrustKeys = expectedKeys(options.entries)
      if (
        trustedHashKeys.size !== expectedTrustKeys.size ||
        [...expectedTrustKeys].some(key => !trustedHashKeys.has(key))
      ) {
        throw new Error('Trust grant entry returned incomplete hashes.')
      }
      await writeLedger(options.runtimeHome, options.executable, trustedHashes)
      return { lane: 'rpc', trustedHashes, detail: null }
    }
    const list = runRpcSession({
      executable: options.executable,
      runtimeHome: options.runtimeHome,
      messages: [
        ...initializeMessages(),
        { id: 2, method: 'hooks/list', params: { cwds: [options.runtimeHome] } },
      ],
    })
    if (list.error) {
      throw new Error(list.error)
    }
    const managed = resolveManagedHooks(
      hooksFromListResult(parseRpcResponse(list.stdout, 2)),
      options.entries,
    )
    if (managed.length !== options.entries.length) {
      throw new Error('hooks/list did not return every managed hook.')
    }
    const trustedHashes = hashesFromHooks(managed)
    const untrusted = managed.filter(hook => hook.trustStatus !== 'trusted')
    if (untrusted.length > 0) {
      const write = runRpcSession({
        executable: options.executable,
        runtimeHome: options.runtimeHome,
        messages: [
          ...initializeMessages(),
          {
            id: 2,
            method: 'config/batchWrite',
            params: {
              edits: [
                {
                  keyPath: 'hooks.state',
                  value: Object.fromEntries(
                    untrusted.map(hook => [hook.key, { trusted_hash: hook.currentHash }]),
                  ),
                  mergeStrategy: 'upsert',
                },
              ],
              reloadUserConfig: true,
            },
          },
          { id: 3, method: 'hooks/list', params: { cwds: [options.runtimeHome] } },
        ],
      })
      if (write.error || !parseRpcResponse(write.stdout, 2)) {
        throw new Error(write.error ?? 'config/batchWrite did not respond.')
      }
      const verified = resolveManagedHooks(
        hooksFromListResult(parseRpcResponse(write.stdout, 3)),
        options.entries,
      )
      if (
        verified.length !== options.entries.length ||
        verified.some(
          hook =>
            hook.trustStatus !== 'trusted' ||
            typeof hook.key !== 'string' ||
            hook.currentHash !== trustedHashes[hook.key],
        )
      ) {
        throw new Error('Managed hook trust verification failed.')
      }
    }
    await writeLedger(options.runtimeHome, options.executable, trustedHashes)
    return { lane: 'rpc', trustedHashes, detail: null }
  } catch (error) {
    await restoreSnapshot(configPath, snapshot).catch(() => undefined)
    await rm(join(options.runtimeHome, 'trust-grant-ledger.json'), { force: true }).catch(
      () => undefined,
    )
    const trustedHashes = Object.fromEntries(
      options.entries.map(entry => [
        computeCodexHookTrustKey({ sourcePath: entry.sourcePath, eventName: entry.eventName }),
        computeCodexHookTrustedHash({
          eventName: entry.eventName,
          command: entry.command,
          timeoutSeconds: entry.timeoutSeconds,
        }),
      ]),
    )
    try {
      await writeAtomic(configPath, appendFallbackTrust(snapshot ?? '', trustedHashes))
    } catch {
      // Hook installation remains fail-open even when neither trust lane can persist.
    }
    return {
      lane: 'fallback',
      trustedHashes,
      detail: error instanceof Error ? error.message : 'Trust RPC failed.',
    }
  }
}

export async function hasTrustConfig(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}
