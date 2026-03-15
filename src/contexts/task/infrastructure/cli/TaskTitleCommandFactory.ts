import type { TaskTitleAgentProvider } from '../../../settings/domain/agentSettings'

interface BuildTaskTitleCommandInput {
  provider: TaskTitleAgentProvider
  requirement: string
  model: string | null
  outputFilePath: string
  availableTags: string[]
}

export interface TaskTitleCommand {
  command: string
  args: string[]
  provider: TaskTitleAgentProvider
  effectiveModel: string | null
  outputMode: 'stdout' | 'file'
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeRequirement(value: string): string {
  const normalized = value.trim()

  if (normalized.length === 0) {
    throw new Error('Task requirement cannot be empty')
  }

  return normalized
}

function normalizeTagOptions(value: string[]): string[] {
  const normalized: string[] = []

  for (const item of value) {
    const tag = item.trim()
    if (tag.length === 0 || normalized.includes(tag)) {
      continue
    }

    normalized.push(tag)
  }

  return normalized
}

function buildTaskProfilePrompt(requirement: string, availableTags: string[]): string {
  const tagsText = availableTags.length > 0 ? availableTags.join(', ') : 'feature, bug, refactor'

  return [
    'You are a concise task planning assistant.',
    'Generate a JSON object for this task requirement.',
    'Output rules:',
    '- Return exactly one JSON object. No markdown fence, no extra text.',
    '- Keys must be: title, priority, tags.',
    '- title: concise and in same language as requirement.',
    '- priority: one of low, medium, high, urgent.',
    '- tags: array of 1-3 tags, and each tag must be selected from available tags only.',
    '',
    `Available tags: ${tagsText}`,
    '',
    'Task requirement:',
    requirement,
  ].join('\n')
}

export function buildTaskTitleCommand(input: BuildTaskTitleCommandInput): TaskTitleCommand {
  const requirement = normalizeRequirement(input.requirement)
  const effectiveModel = normalizeOptionalText(input.model)
  const availableTags = normalizeTagOptions(input.availableTags)
  const prompt = buildTaskProfilePrompt(requirement, availableTags)

  if (input.provider === 'claude-code') {
    const args = ['-p', '--tools', '']

    if (effectiveModel) {
      args.push('--model', effectiveModel)
    }

    args.push(prompt)

    return {
      command: 'claude',
      args,
      provider: input.provider,
      effectiveModel,
      outputMode: 'stdout',
    }
  }

  const args = [
    'exec',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '-c',
    'reasoning.effort="low"',
  ]

  if (effectiveModel) {
    args.push('--model', effectiveModel)
  }

  args.push('-o', input.outputFilePath)
  args.push(prompt)

  return {
    command: 'codex',
    args,
    provider: input.provider,
    effectiveModel,
    outputMode: 'file',
  }
}
