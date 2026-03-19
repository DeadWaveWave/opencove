import { execFile } from 'node:child_process'
import type {
  AgentModelOption,
  AgentProviderId,
  ListAgentModelsResult,
} from '@shared/contracts/dto'
import { resolveAgentCliInvocation } from './AgentCliInvocation'
import { disposeCodexModelCatalog, listCodexModelsFromCli } from './CodexModelCatalog'
import { listGeminiCliFallbackModels, listGeminiCliModelsFromSchema } from './GeminiModelCatalog'
import { createAppErrorDescriptor } from '../../../../shared/errors/appError'

const CODEX_MODEL_CACHE_TTL_MS = 30_000
const CODEX_MODEL_ERROR_CACHE_TTL_MS = 5_000
const GEMINI_MODEL_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const GEMINI_MODEL_FALLBACK_CACHE_TTL_MS = 5 * 60 * 1000
const CLI_MODEL_LIST_TIMEOUT_MS = 8000
const CLI_MODEL_LIST_MAX_BUFFER_BYTES = 16 * 1024 * 1024

let cachedCodexModels: {
  result: ListAgentModelsResult
  expiresAtMs: number
} | null = null

let codexModelsRequestInFlight: Promise<ListAgentModelsResult> | null = null

let cachedGeminiModels: {
  result: ListAgentModelsResult
  expiresAtMs: number
  isFallback: boolean
} | null = null

let geminiModelsRequestInFlight: Promise<ListAgentModelsResult> | null = null

const CLAUDE_CODE_STATIC_MODELS: AgentModelOption[] = [
  {
    id: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6',
    description: 'Official Claude Code default model',
    isDefault: true,
  },
  {
    id: 'claude-sonnet-4-6[1m]',
    displayName: 'Claude Sonnet 4.6 (1M)',
    description: 'Official Claude Code default model (1M context)',
    isDefault: false,
  },
  {
    id: 'claude-opus-4-6',
    displayName: 'Claude Opus 4.6',
    description: 'Official Claude Code model',
    isDefault: false,
  },
  {
    id: 'claude-opus-4-6[1m]',
    displayName: 'Claude Opus 4.6 (1M)',
    description: 'Official Claude Code model (1M context)',
    isDefault: false,
  },
]

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === 'string' && error.length > 0) {
    return error
  }

  return 'Unknown error'
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

function rememberGeminiModels(
  result: ListAgentModelsResult,
  options: { isFallback: boolean },
): ListAgentModelsResult {
  cachedGeminiModels = {
    result: cloneListAgentModelsResult(result),
    expiresAtMs:
      Date.now() +
      (options.isFallback ? GEMINI_MODEL_FALLBACK_CACHE_TTL_MS : GEMINI_MODEL_CACHE_TTL_MS),
    isFallback: options.isFallback,
  }

  return cloneListAgentModelsResult(result)
}

function readCachedGeminiModels(): ListAgentModelsResult | null {
  if (!cachedGeminiModels) {
    return null
  }

  if (Date.now() > cachedGeminiModels.expiresAtMs) {
    cachedGeminiModels = null
    return null
  }

  return cloneListAgentModelsResult(cachedGeminiModels.result)
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
  geminiModelsRequestInFlight = null
  cachedGeminiModels = null

  disposeCodexModelCatalog()
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
    const cachedResult = readCachedGeminiModels()
    if (cachedResult) {
      return cachedResult
    }

    if (!geminiModelsRequestInFlight) {
      geminiModelsRequestInFlight = (async () => {
        const fetchedAt = new Date().toISOString()

        try {
          const models = await listGeminiCliModelsFromSchema()
          const isFallback = models.length === 0

          return rememberGeminiModels(
            {
              provider,
              source: 'gemini-cli',
              fetchedAt,
              models: models.length > 0 ? models : listGeminiCliFallbackModels(),
              error: null,
            },
            { isFallback },
          )
        } catch {
          return rememberGeminiModels(
            {
              provider,
              source: 'gemini-cli',
              fetchedAt,
              models: listGeminiCliFallbackModels(),
              error: null,
            },
            { isFallback: true },
          )
        } finally {
          geminiModelsRequestInFlight = null
        }
      })()
    }

    return cloneListAgentModelsResult(await geminiModelsRequestInFlight)
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
