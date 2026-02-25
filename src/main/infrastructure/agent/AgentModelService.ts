import { spawn } from 'node:child_process'
import type {
  AgentModelOption,
  AgentProviderId,
  ListAgentModelsResult,
} from '../../../shared/types/api'

const CODEX_APP_SERVER_TIMEOUT_MS = 8000

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
    // Keep stdin open until we receive model/list response; premature EOF can make
    // codex app-server exit before sending the result payload.
  })
}

function listClaudeCodeStaticModels(): AgentModelOption[] {
  return CLAUDE_CODE_STATIC_MODELS.map(model => ({ ...model }))
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

  return {
    provider,
    source: 'claude-static',
    fetchedAt,
    models: listClaudeCodeStaticModels(),
    error: null,
  }
}
