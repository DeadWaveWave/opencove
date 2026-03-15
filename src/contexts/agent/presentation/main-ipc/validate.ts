import type {
  AgentProviderId,
  LaunchAgentInput,
  ListAgentModelsInput,
  ReadAgentLastMessageInput,
  ResolveAgentResumeSessionInput,
} from '../../../../shared/contracts/dto'
import { normalizeProvider } from '../../../../app/main/ipc/normalize'
import { isAbsolute } from 'node:path'

export function normalizeListModelsPayload(payload: unknown): ListAgentModelsInput {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid provider for agent:list-models')
  }

  const record = payload as Record<string, unknown>

  return {
    provider: normalizeProvider(record.provider),
  }
}

export function normalizeResolveResumeSessionPayload(
  payload: unknown,
): ResolveAgentResumeSessionInput {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid payload for agent:resolve-resume-session')
  }

  const record = payload as Record<string, unknown>
  const provider = normalizeProvider(record.provider)
  const cwd = typeof record.cwd === 'string' ? record.cwd.trim() : ''
  const startedAt = typeof record.startedAt === 'string' ? record.startedAt.trim() : ''

  if (cwd.length === 0) {
    throw new Error('Invalid cwd for agent:resolve-resume-session')
  }

  if (!isAbsolute(cwd)) {
    throw new Error('agent:resolve-resume-session requires an absolute cwd')
  }

  if (!Number.isFinite(Date.parse(startedAt))) {
    throw new Error('agent:resolve-resume-session requires a valid startedAt')
  }

  return { provider, cwd, startedAt }
}

export function normalizeReadLastMessagePayload(payload: unknown): ReadAgentLastMessageInput {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid payload for agent:read-last-message')
  }

  const record = payload as Record<string, unknown>
  const provider = normalizeProvider(record.provider)
  const cwd = typeof record.cwd === 'string' ? record.cwd.trim() : ''
  const startedAt = typeof record.startedAt === 'string' ? record.startedAt.trim() : ''
  const resumeSessionId =
    typeof record.resumeSessionId === 'string' ? record.resumeSessionId.trim() : ''

  if (cwd.length === 0) {
    throw new Error('Invalid cwd for agent:read-last-message')
  }

  if (!isAbsolute(cwd)) {
    throw new Error('agent:read-last-message requires an absolute cwd')
  }

  if (!Number.isFinite(Date.parse(startedAt))) {
    throw new Error('agent:read-last-message requires a valid startedAt')
  }

  return {
    provider,
    cwd,
    startedAt,
    resumeSessionId: resumeSessionId.length > 0 ? resumeSessionId : null,
  }
}

export function resolveAgentTestStub(
  provider: AgentProviderId,
  cwd: string,
  model: string | null,
  mode: LaunchAgentInput['mode'],
): {
  command: string
  args: string[]
} | null {
  if (process.env.NODE_ENV !== 'test') {
    return null
  }

  const sessionScenario = process.env['OPENCOVE_TEST_AGENT_SESSION_SCENARIO']?.trim() ?? ''
  const stubScriptPath = process.env['OPENCOVE_TEST_AGENT_STUB_SCRIPT']?.trim() ?? ''

  if (sessionScenario.length > 0 && stubScriptPath.length > 0) {
    return {
      command: process.execPath,
      args: [
        stubScriptPath,
        provider,
        cwd,
        mode ?? 'new',
        model ?? 'default-model',
        sessionScenario,
      ],
    }
  }

  if (process.platform === 'win32') {
    const message = `[cove-test-agent] ${provider} ${mode ?? 'new'} ${model ?? 'default-model'}`
    return {
      command: 'powershell.exe',
      args: [
        '-NoLogo',
        '-NoProfile',
        '-Command',
        `Write-Output "${message}"; Start-Sleep -Seconds 120`,
      ],
    }
  }

  const shell = process.env.SHELL ?? '/bin/zsh'
  const message = `[cove-test-agent] ${provider} ${mode ?? 'new'} ${model ?? 'default-model'}`

  return {
    command: shell,
    args: ['-lc', `printf '%s\\n' "${message}"; sleep 120`],
  }
}

export function normalizeLaunchAgentPayload(payload: unknown): LaunchAgentInput {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid payload for agent:launch')
  }

  const record = payload as Record<string, unknown>
  const provider = normalizeProvider(record.provider)
  const cwd = typeof record.cwd === 'string' ? record.cwd.trim() : ''
  const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : ''
  const mode = record.mode === 'resume' ? 'resume' : 'new'

  const model = typeof record.model === 'string' ? record.model.trim() : ''
  const resumeSessionId =
    typeof record.resumeSessionId === 'string' ? record.resumeSessionId.trim() : ''

  const agentFullAccess =
    typeof record.agentFullAccess === 'boolean' ? record.agentFullAccess : true

  const cols =
    typeof record.cols === 'number' && Number.isFinite(record.cols) && record.cols > 0
      ? Math.floor(record.cols)
      : 80
  const rows =
    typeof record.rows === 'number' && Number.isFinite(record.rows) && record.rows > 0
      ? Math.floor(record.rows)
      : 24

  if (cwd.length === 0) {
    throw new Error('Invalid cwd for agent:launch')
  }

  if (!isAbsolute(cwd)) {
    throw new Error('agent:launch requires an absolute cwd')
  }

  return {
    provider,
    cwd,
    prompt,
    mode,
    model: model.length > 0 ? model : null,
    resumeSessionId: resumeSessionId.length > 0 ? resumeSessionId : null,
    agentFullAccess,
    cols,
    rows,
  }
}
