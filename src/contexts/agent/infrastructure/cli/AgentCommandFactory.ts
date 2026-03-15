import type { AgentLaunchMode, AgentProviderId } from '@shared/contracts/dto'

interface OpenCodeServerBinding {
  hostname: string
  port: number
}

interface BuildAgentLaunchCommandInput {
  provider: AgentProviderId
  mode: AgentLaunchMode
  prompt?: string
  model: string | null
  resumeSessionId: string | null
  agentFullAccess?: boolean
  opencodeServer?: OpenCodeServerBinding | null
}

export interface AgentLaunchCommand {
  command: string
  args: string[]
  launchMode: AgentLaunchMode
  effectiveModel: string | null
  resumeSessionId: string | null
}

function normalizeOptionalValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function normalizePrompt(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function maybeTerminateOptionParsing(args: string[], value: string): void {
  if (value.startsWith('-')) {
    args.push('--')
  }
}

export function buildAgentLaunchCommand(input: BuildAgentLaunchCommandInput): AgentLaunchCommand {
  const effectiveModel = normalizeOptionalValue(input.model)
  const resumeSessionId = normalizeOptionalValue(input.resumeSessionId)
  const agentFullAccess = input.agentFullAccess ?? true

  if (input.provider === 'claude-code') {
    const args: string[] = []

    if (agentFullAccess) {
      args.push('--dangerously-skip-permissions')
    }

    if (effectiveModel) {
      args.push('--model', effectiveModel)
    }

    if (input.mode === 'resume') {
      if (resumeSessionId) {
        args.push('--resume', resumeSessionId)
      } else {
        args.push('--continue')
      }

      return {
        command: 'claude',
        args,
        launchMode: 'resume',
        effectiveModel,
        resumeSessionId,
      }
    }

    const prompt = normalizePrompt(input.prompt)
    if (prompt.length > 0) {
      maybeTerminateOptionParsing(args, prompt)
      args.push(prompt)
    }

    return {
      command: 'claude',
      args,
      launchMode: 'new',
      effectiveModel,
      resumeSessionId: null,
    }
  }

  if (input.provider === 'opencode') {
    if (!input.opencodeServer) {
      throw new Error('opencode launch requires a reserved local server port')
    }

    const args = [
      '--hostname',
      input.opencodeServer.hostname,
      '--port',
      String(input.opencodeServer.port),
    ]

    if (effectiveModel) {
      args.push('--model', effectiveModel)
    }

    if (input.mode === 'resume') {
      if (!resumeSessionId) {
        throw new Error('opencode resume requires explicit session id')
      }

      args.push('--session', resumeSessionId, '.')

      return {
        command: 'opencode',
        args,
        launchMode: 'resume',
        effectiveModel,
        resumeSessionId,
      }
    }

    const prompt = normalizePrompt(input.prompt)
    if (prompt.length > 0) {
      args.push('--prompt', prompt)
    }

    args.push('.')

    return {
      command: 'opencode',
      args,
      launchMode: 'new',
      effectiveModel,
      resumeSessionId: null,
    }
  }

  if (input.provider === 'gemini') {
    const args: string[] = []

    if (agentFullAccess) {
      args.push('--yolo')
    }

    if (effectiveModel) {
      args.push('--model', effectiveModel)
    }

    if (input.mode === 'resume') {
      if (!resumeSessionId) {
        throw new Error('gemini resume requires explicit session id')
      }

      args.push('--resume', resumeSessionId)

      return {
        command: 'gemini',
        args,
        launchMode: 'resume',
        effectiveModel,
        resumeSessionId,
      }
    }

    const prompt = normalizePrompt(input.prompt)
    if (prompt.length > 0) {
      args.push('--prompt-interactive', prompt)
    }

    return {
      command: 'gemini',
      args,
      launchMode: 'new',
      effectiveModel,
      resumeSessionId: null,
    }
  }

  if (input.mode === 'resume') {
    if (!resumeSessionId) {
      throw new Error('codex resume requires explicit session id')
    }

    const args = [
      agentFullAccess ? '--dangerously-bypass-approvals-and-sandbox' : '--full-auto',
      'resume',
      resumeSessionId,
    ]

    if (effectiveModel) {
      args.push('--model', effectiveModel)
    }

    return {
      command: 'codex',
      args,
      launchMode: 'resume',
      effectiveModel,
      resumeSessionId,
    }
  }

  const args = [agentFullAccess ? '--dangerously-bypass-approvals-and-sandbox' : '--full-auto']

  if (effectiveModel) {
    args.push('--model', effectiveModel)
  }

  const prompt = normalizePrompt(input.prompt)
  if (prompt.length > 0) {
    maybeTerminateOptionParsing(args, prompt)
    args.push(prompt)
  }

  return {
    command: 'codex',
    args,
    launchMode: 'new',
    effectiveModel,
    resumeSessionId: null,
  }
}
