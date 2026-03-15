import type { WorktreeNameSuggestionAgentProvider } from '../../../settings/domain/agentSettings'

interface BuildSuggestionCommandInput {
  provider: WorktreeNameSuggestionAgentProvider
  prompt: string
  model: string | null
  outputFilePath: string
}

export interface WorktreeNameSuggestionCommand {
  command: string
  args: string[]
  provider: WorktreeNameSuggestionAgentProvider
  effectiveModel: string | null
  outputMode: 'stdout' | 'file'
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function buildWorktreeNameSuggestionCommand(
  input: BuildSuggestionCommandInput,
): WorktreeNameSuggestionCommand {
  const effectiveModel = normalizeOptionalText(input.model)

  if (input.provider === 'claude-code') {
    const args = ['-p', '--tools', '']

    if (effectiveModel) {
      args.push('--model', effectiveModel)
    }

    args.push(input.prompt)

    return {
      command: 'claude',
      args,
      provider: input.provider,
      effectiveModel,
      outputMode: 'stdout',
    }
  }

  const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only']

  if (effectiveModel) {
    args.push('--model', effectiveModel)
  }

  args.push('-o', input.outputFilePath)
  args.push(input.prompt)

  return {
    command: 'codex',
    args,
    provider: input.provider,
    effectiveModel,
    outputMode: 'file',
  }
}
