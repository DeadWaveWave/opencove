import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type {
  AgentModelOption,
  AgentProviderId,
  ListAgentModelsResult,
} from '@shared/contracts/dto'
import { resolveAgentCliInvocation } from './AgentCliInvocation'
import { createAppErrorDescriptor } from '../../../../shared/errors/appError'

const CODEX_APP_SERVER_TIMEOUT_MS = 8000
const CODEX_APP_SERVER_SHUTDOWN_GRACE_MS = 500
const CODEX_MODEL_CACHE_TTL_MS = 30_000
const CODEX_MODEL_ERROR_CACHE_TTL_MS = 5_000
const CLI_MODEL_LIST_TIMEOUT_MS = 8000
const CLI_MODEL_LIST_MAX_BUFFER_BYTES = 16 * 1024 * 1024

const activeCodexModelChildren = new Set<ChildProcessWithoutNullStreams>()

let cachedCodexModels: {
  result: ListAgentModelsResult
  expiresAtMs: number
} | null = null

let codexModelsRequestInFlight: Promise<ListAgentModelsResult> | null = null

const CLAUDE_CODE_STATIC_MODELS: AgentModelOption[] = [
  {
    id: 'claude-opus-4-6',
    displayName: 'Claude Opus 4.6',
    description: 'Official Claude Code model',
    isDefault: false,
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    displayName: 'Claude Sonnet 4.5',
    description: 'Official Claude Code default model',
    isDefault: true,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    displayName: 'Claude Haiku 4.5',
    description: 'Official Claude Code fast model',
    isDefault: false,
  },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === 'string' && error.length > 0) {
    return error
  }

  return 'Unknown error'
}

function normalizeCodexModel(item: unknown): AgentModelOption | null {
  if (!isRecord(item)) {
    return null
  }

  const model =
    typeof item.model === 'string' ? item.model : typeof item.id === 'string' ? item.id : null

  if (!model) {
    return null
  }

  return {
    id: model,
    displayName: typeof item.displayName === 'string' ? item.displayName : model,
    description: typeof item.description === 'string' ? item.description : '',
    isDefault: item.isDefault === true,
  }
}

function extractRpcErrorMessage(payload: Record<string, unknown>): string {
  const value = payload.error

  if (typeof value === 'string' && value.length > 0) {
    return value
  }

  if (isRecord(value) && typeof value.message === 'string' && value.message.length > 0) {
    return value.message
  }

  return 'Unknown RPC error'
}

function cloneAgentModelOption(model: AgentModelOption): AgentModelOption {
  return {
    id: model.id,
    displayName: model.displayName,
    description: model.description,
    isDefault: model.isDefault,
  }
}

function cloneListAgentModelsResult(result: ListAgentModelsResult): ListAgentModelsResult {
  return {
    provider: result.provider,
    source: result.source,
    fetchedAt: result.fetchedAt,
    error: result.error ? { ...result.error } : null,
    models: result.models.map(cloneAgentModelOption),
  }
}

function isChildProcessExited(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

function trackCodexModelChild(child: ChildProcessWithoutNullStreams): void {
  activeCodexModelChildren.add(child)

  const untrack = (): void => {
    activeCodexModelChildren.delete(child)
  }

  child.once('exit', untrack)
  child.once('close', untrack)
}

function terminateCodexModelChild(child: ChildProcessWithoutNullStreams): void {
  try {
    child.stdin.end()
  } catch {
    // ignore stdin teardown failures
  }

  if (isChildProcessExited(child)) {
    return
  }

  try {
    child.kill('SIGTERM')
  } catch {
    return
  }

  const forceKillTimer = setTimeout(() => {
    if (isChildProcessExited(child)) {
      return
    }

    try {
      child.kill('SIGKILL')
    } catch {
      // ignore force-kill failures
    }
  }, CODEX_APP_SERVER_SHUTDOWN_GRACE_MS)

  forceKillTimer.unref()
}

function rememberCodexModels(result: ListAgentModelsResult): ListAgentModelsResult {
  cachedCodexModels = {
    result: cloneListAgentModelsResult(result),
    expiresAtMs:
      Date.now() +
      (result.error === null ? CODEX_MODEL_CACHE_TTL_MS : CODEX_MODEL_ERROR_CACHE_TTL_MS),
  }

  return cloneListAgentModelsResult(result)
}

function readCachedCodexModels(): ListAgentModelsResult | null {
  if (!cachedCodexModels) {
    return null
  }

  if (Date.now() > cachedCodexModels.expiresAtMs) {
    cachedCodexModels = null
    return null
  }

  return cloneListAgentModelsResult(cachedCodexModels.result)
}

async function listCodexModelsFromCli(): Promise<AgentModelOption[]> {
  const invocation = await resolveAgentCliInvocation({
    command: 'codex',
    args: ['app-server'],
  })

  return await new Promise<AgentModelOption[]>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    })
    trackCodexModelChild(child)

    let stdoutBuffer = ''
    let stderrBuffer = ''
    let isSettled = false

    const handleStdout = (chunk: Buffer | string): void => {
      stdoutBuffer += chunk.toString()
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() ?? ''

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (line.length === 0) {
          continue
        }

        let parsed: unknown
        try {
          parsed = JSON.parse(line)
        } catch {
          continue
        }

        if (!isRecord(parsed) || parsed.id !== '2') {
          continue
        }

        if ('error' in parsed) {
          settleReject(new Error(extractRpcErrorMessage(parsed)))
          return
        }

        if (!isRecord(parsed.result) || !Array.isArray(parsed.result.data)) {
          settleReject(new Error('Invalid model/list response payload'))
          return
        }

        const models = parsed.result.data
          .map(item => normalizeCodexModel(item))
          .filter((item): item is AgentModelOption => item !== null)

        settleResolve(models)
        return
      }
    }

    const handleStderr = (chunk: Buffer | string): void => {
      stderrBuffer += chunk.toString()
    }

    const handleError = (error: Error): void => {
      settleReject(error)
    }

    const handleExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (isSettled) {
        return
      }

      const detail = stderrBuffer.trim()
      const base = `codex app-server exited before model/list response (code=${code ?? 'null'}, signal=${signal ?? 'null'})`
      settleReject(new Error(detail.length > 0 ? `${base}: ${detail}` : base))
    }

    const timeout = setTimeout(() => {
      settleReject(new Error('Timed out while requesting models from codex app-server'))
    }, CODEX_APP_SERVER_TIMEOUT_MS)

    const cleanup = (): void => {
      clearTimeout(timeout)
      child.stdout.off('data', handleStdout)
      child.stderr.off('data', handleStderr)
      child.off('error', handleError)
      child.off('exit', handleExit)
      terminateCodexModelChild(child)
    }

    const settleResolve = (models: AgentModelOption[]): void => {
      if (isSettled) {
        return
      }

      isSettled = true
      cleanup()
      resolve(models)
    }

    const settleReject = (error: unknown): void => {
      if (isSettled) {
        return
      }

      isSettled = true
      cleanup()
      reject(error)
    }

    child.on('error', handleError)
    child.on('exit', handleExit)
    child.stderr.on('data', handleStderr)
    child.stdout.on('data', handleStdout)

    const initializeMessage = {
      id: '1',
      method: 'initialize',
      params: {
        clientInfo: {
          name: 'cove',
          version: '0.1.0',
        },
      },
    }

    const modelListMessage = {
      id: '2',
      method: 'model/list',
      params: {
        limit: 200,
      },
    }

    child.stdin.write(`${JSON.stringify(initializeMessage)}\n`)
    child.stdin.write(`${JSON.stringify(modelListMessage)}\n`)
    // Keep stdin open until we receive model/list response; premature EOF can make
    // codex app-server exit before sending the result payload.
  })
}

async function executeCliText(command: string, args: string[]): Promise<string> {
  const invocation = await resolveAgentCliInvocation({ command, args })

  return await new Promise((resolve, reject) => {
    execFile(
      invocation.command,
      invocation.args,
      {
        env: process.env,
        encoding: 'utf8',
        windowsHide: true,
        timeout: CLI_MODEL_LIST_TIMEOUT_MS,
        maxBuffer: CLI_MODEL_LIST_MAX_BUFFER_BYTES,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = typeof stderr === 'string' ? stderr.trim() : ''
          reject(
            new Error(detail.length > 0 ? detail : error.message || 'CLI command execution failed'),
          )
          return
        }

        resolve(stdout)
      },
    )
  })
}

async function listOpenCodeModelsFromCli(): Promise<AgentModelOption[]> {
  const stdout = await executeCliText('opencode', ['models'])

  return stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(modelId => ({
      id: modelId,
      displayName: modelId,
      description: '',
      isDefault: false,
    }))
}

function listClaudeCodeStaticModels(): AgentModelOption[] {
  return CLAUDE_CODE_STATIC_MODELS.map(model => ({ ...model }))
}

export function disposeAgentModelService(): void {
  codexModelsRequestInFlight = null
  cachedCodexModels = null

  for (const child of activeCodexModelChildren) {
    terminateCodexModelChild(child)
  }
}

export async function listAgentModels(provider: AgentProviderId): Promise<ListAgentModelsResult> {
  if (provider === 'codex') {
    const cachedResult = readCachedCodexModels()
    if (cachedResult) {
      return cachedResult
    }

    if (!codexModelsRequestInFlight) {
      codexModelsRequestInFlight = (async () => {
        const fetchedAt = new Date().toISOString()

        try {
          const models = await listCodexModelsFromCli()
          return rememberCodexModels({
            provider,
            source: 'codex-cli',
            fetchedAt,
            models,
            error: null,
          })
        } catch (error) {
          return rememberCodexModels({
            provider,
            source: 'codex-cli',
            fetchedAt,
            models: [],
            error: createAppErrorDescriptor('agent.list_models_failed', {
              debugMessage: toErrorMessage(error),
            }),
          })
        } finally {
          codexModelsRequestInFlight = null
        }
      })()
    }

    return cloneListAgentModelsResult(await codexModelsRequestInFlight)
  }

  if (provider === 'opencode') {
    const fetchedAt = new Date().toISOString()

    try {
      return {
        provider,
        source: 'opencode-cli',
        fetchedAt,
        models: await listOpenCodeModelsFromCli(),
        error: null,
      }
    } catch (error) {
      return {
        provider,
        source: 'opencode-cli',
        fetchedAt,
        models: [],
        error: createAppErrorDescriptor('agent.list_models_failed', {
          debugMessage: toErrorMessage(error),
        }),
      }
    }
  }

  if (provider === 'gemini') {
    return {
      provider,
      source: 'gemini-cli',
      fetchedAt: new Date().toISOString(),
      models: [],
      error: null,
    }
  }

  const fetchedAt = new Date().toISOString()

  return {
    provider,
    source: 'claude-static',
    fetchedAt,
    models: listClaudeCodeStaticModels(),
    error: null,
  }
}
