import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { AgentModelOption } from '@shared/contracts/dto'
import { resolveAgentCliInvocation } from './AgentCliInvocation'

const CODEX_APP_SERVER_TIMEOUT_MS = 8000
const CODEX_APP_SERVER_SHUTDOWN_GRACE_MS = 500

const activeCodexModelChildren = new Set<ChildProcessWithoutNullStreams>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
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

export function disposeCodexModelCatalog(): void {
  for (const child of activeCodexModelChildren) {
    terminateCodexModelChild(child)
  }
}

export async function listCodexModelsFromCli(): Promise<AgentModelOption[]> {
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
