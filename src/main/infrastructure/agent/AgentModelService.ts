import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentModelOption,
  AgentProviderId,
  ListAgentModelsResult,
} from '../../../shared/types/api'

const CODEX_APP_SERVER_TIMEOUT_MS = 8000
const CLAUDE_MODELS_ENDPOINT = 'https://api.anthropic.com/v1/models'
const CLAUDE_API_VERSION = '2023-06-01'

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function resolveEnvValue(keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  return null
}

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

function normalizeClaudeModel(item: unknown): AgentModelOption | null {
  if (!isRecord(item)) {
    return null
  }

  const id = typeof item.id === 'string' ? item.id : null
  if (!id) {
    return null
  }

  const displayName =
    typeof item.display_name === 'string'
      ? item.display_name
      : typeof item.displayName === 'string'
        ? item.displayName
        : id

  return {
    id,
    displayName,
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

async function listCodexModelsFromCli(): Promise<AgentModelOption[]> {
  return await new Promise<AgentModelOption[]>((resolve, reject) => {
    const child = spawn('codex', ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    })

    let stdoutBuffer = ''
    let stderrBuffer = ''
    let isSettled = false

    const timeout = setTimeout(() => {
      settleReject(new Error('Timed out while requesting models from codex app-server'))
    }, CODEX_APP_SERVER_TIMEOUT_MS)

    const killChild = (): void => {
      if (child.killed) {
        return
      }

      child.kill('SIGTERM')
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL')
        }
      }, 500).unref()
    }

    const cleanup = (): void => {
      clearTimeout(timeout)
      child.stdout.removeAllListeners()
      child.stderr.removeAllListeners()
      child.removeAllListeners()
      killChild()
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

    child.on('error', error => {
      settleReject(error)
    })

    child.on('exit', (code, signal) => {
      if (isSettled) {
        return
      }

      const detail = stderrBuffer.trim()
      const base = `codex app-server exited before model/list response (code=${code ?? 'null'}, signal=${signal ?? 'null'})`
      settleReject(new Error(detail.length > 0 ? `${base}: ${detail}` : base))
    })

    child.stderr.on('data', chunk => {
      stderrBuffer += chunk.toString()
    })

    child.stdout.on('data', chunk => {
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
    })

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
    child.stdin.end()
  })
}

async function readClaudeApiKeyFromConfig(): Promise<string | null> {
  const configPath = join(homedir(), '.claude', 'config.json')

  try {
    const raw = await readFile(configPath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown

    if (!isRecord(parsed)) {
      return null
    }

    if (typeof parsed.primaryApiKey === 'string' && parsed.primaryApiKey.trim().length > 0) {
      return parsed.primaryApiKey.trim()
    }

    return null
  } catch {
    return null
  }
}

async function resolveClaudeApiKey(): Promise<string | null> {
  const envKey = resolveEnvValue([
    'ANTHROPIC_API_KEY',
    'CLAUDE_API_KEY',
    'CLAUDE_CODE_API_KEY',
    'CLAUDE_APIKEY',
  ])

  if (envKey) {
    return envKey
  }

  return await readClaudeApiKeyFromConfig()
}

function resolveClaudeModelsEndpoint(): string {
  const baseUrl = resolveEnvValue([
    'ANTHROPIC_BASE_URL',
    'CLAUDE_BASE_URL',
    'CLAUDE_CODE_BASE_URL',
    'ANTHROPIC_API_BASE_URL',
  ])

  if (!baseUrl) {
    return CLAUDE_MODELS_ENDPOINT
  }

  return `${normalizeBaseUrl(baseUrl)}/v1/models`
}

async function listClaudeModelsFromApi(): Promise<AgentModelOption[]> {
  const apiKey = await resolveClaudeApiKey()
  const endpoint = resolveClaudeModelsEndpoint()

  if (!apiKey) {
    throw new Error(
      'Claude API key not found (ANTHROPIC_API_KEY / CLAUDE_API_KEY / CLAUDE_CODE_API_KEY / CLAUDE_APIKEY / ~/.claude/config.json)',
    )
  }

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': CLAUDE_API_VERSION,
      'content-type': 'application/json',
    },
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`Claude API request failed (${response.status}): ${details}`)
  }

  const payload = (await response.json()) as unknown

  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error('Invalid Claude models response payload')
  }

  return payload.data
    .map(item => normalizeClaudeModel(item))
    .filter((item): item is AgentModelOption => item !== null)
}

export async function listAgentModels(provider: AgentProviderId): Promise<ListAgentModelsResult> {
  const fetchedAt = new Date().toISOString()

  if (provider === 'codex') {
    try {
      const models = await listCodexModelsFromCli()
      return {
        provider,
        source: 'codex-cli',
        fetchedAt,
        models,
        error: null,
      }
    } catch (error) {
      return {
        provider,
        source: 'codex-cli',
        fetchedAt,
        models: [],
        error: toErrorMessage(error),
      }
    }
  }

  try {
    const models = await listClaudeModelsFromApi()
    return {
      provider,
      source: 'claude-api',
      fetchedAt,
      models,
      error: null,
    }
  } catch (error) {
    return {
      provider,
      source: 'claude-api',
      fetchedAt,
      models: [],
      error: toErrorMessage(error),
    }
  }
}
