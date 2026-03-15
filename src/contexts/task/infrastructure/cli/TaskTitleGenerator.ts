import { spawn } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isTaskTitleAgentProvider } from '../../../settings/domain/agentSettings'
import type {
  SuggestTaskTitleInput,
  SuggestTaskTitleResult,
  TaskPriority,
} from '../../../../shared/contracts/dto'
import { buildTaskTitleCommand } from './TaskTitleCommandFactory'

const TASK_TITLE_TIMEOUT_MS = 30_000
const TASK_TITLE_MAX_LENGTH = 96
const TASK_PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent']

interface CommandExecutionResult {
  exitCode: number
  stdout: string
  stderr: string
}

interface ParsedTaskProfile {
  title: string
  priority: TaskPriority
  tags: string[]
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

function normalizeAvailableTags(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return []
  }

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

function fallbackTaskTitle(requirement: string): string {
  const cleaned = requirement.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= 24) {
    return cleaned
  }

  return `${cleaned.slice(0, 24)}...`
}

function normalizeTaskTitle(raw: string, requirement: string): string {
  const line = raw
    .split(/\r?\n/)
    .map(item => item.trim())
    .find(item => item.length > 0)

  const normalized = (line ?? '')
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (normalized.length === 0) {
    return fallbackTaskTitle(requirement)
  }

  if (normalized.length > TASK_TITLE_MAX_LENGTH) {
    return `${normalized.slice(0, TASK_TITLE_MAX_LENGTH)}...`
  }

  return normalized
}

function normalizePriority(value: unknown): TaskPriority {
  if (typeof value !== 'string') {
    return 'medium'
  }

  const normalized = value.trim().toLowerCase()
  return TASK_PRIORITIES.includes(normalized as TaskPriority)
    ? (normalized as TaskPriority)
    : 'medium'
}

function normalizeTags(tags: unknown, availableTags: string[]): string[] {
  if (!Array.isArray(tags)) {
    return []
  }

  const normalized: string[] = []
  for (const item of tags) {
    if (typeof item !== 'string') {
      continue
    }

    const tag = item.trim()
    if (tag.length === 0) {
      continue
    }

    if (availableTags.length > 0 && !availableTags.includes(tag)) {
      continue
    }

    if (!normalized.includes(tag)) {
      normalized.push(tag)
    }

    if (normalized.length >= 3) {
      break
    }
  }

  return normalized
}

function fallbackTaskProfile(requirement: string, availableTags: string[]): ParsedTaskProfile {
  const fallbackTags = availableTags.length > 0 ? [availableTags[0]] : []

  return {
    title: fallbackTaskTitle(requirement),
    priority: 'medium',
    tags: fallbackTags,
  }
}

function parseTaskProfile(
  rawOutput: string,
  requirement: string,
  availableTags: string[],
): ParsedTaskProfile {
  const fallback = fallbackTaskProfile(requirement, availableTags)

  const firstObjectMatch = rawOutput.match(/\{[\s\S]*\}/)
  const candidate = firstObjectMatch ? firstObjectMatch[0] : rawOutput

  try {
    const parsed = JSON.parse(candidate) as {
      title?: unknown
      priority?: unknown
      tags?: unknown
    }

    const title = normalizeTaskTitle(
      typeof parsed.title === 'string' ? parsed.title : '',
      requirement,
    )
    const priority = normalizePriority(parsed.priority)
    const tags = normalizeTags(parsed.tags, availableTags)

    return {
      title,
      priority,
      tags: tags.length > 0 ? tags : fallback.tags,
    }
  } catch {
    return {
      title: normalizeTaskTitle(rawOutput, requirement),
      priority: fallback.priority,
      tags: fallback.tags,
    }
  }
}

function testModeTitle(requirement: string): string {
  const normalized = fallbackTaskTitle(requirement)
  return `Auto: ${normalized}`
}

async function executeCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<CommandExecutionResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timeoutHandle = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, TASK_TITLE_TIMEOUT_MS)

    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })

    child.on('error', error => {
      clearTimeout(timeoutHandle)
      reject(error)
    })

    child.on('close', exitCode => {
      clearTimeout(timeoutHandle)

      if (timedOut) {
        reject(new Error('Task title generation timed out'))
        return
      }

      resolve({
        exitCode: typeof exitCode === 'number' ? exitCode : 1,
        stdout,
        stderr,
      })
    })
  })
}

export async function suggestTaskTitle(
  input: SuggestTaskTitleInput,
): Promise<SuggestTaskTitleResult> {
  const requirement = input.requirement.trim()
  const cwd = input.cwd.trim()
  const availableTags = normalizeAvailableTags(input.availableTags)

  if (requirement.length === 0) {
    throw new Error('Task requirement cannot be empty')
  }

  if (cwd.length === 0) {
    throw new Error('Task title generation requires cwd')
  }

  if (process.env.NODE_ENV === 'test') {
    return {
      title: testModeTitle(requirement),
      priority: 'medium',
      tags: availableTags.length > 0 ? [availableTags[0]] : [],
      provider: input.provider,
      effectiveModel: input.model ?? null,
    }
  }

  if (!isTaskTitleAgentProvider(input.provider)) {
    throw new Error(`Task title generation does not support provider: ${input.provider}`)
  }

  const outputFilePath = join(tmpdir(), `cove-task-title-${crypto.randomUUID()}.txt`)

  const command = buildTaskTitleCommand({
    provider: input.provider,
    requirement,
    model: input.model ?? null,
    outputFilePath,
    availableTags,
  })

  try {
    const result = await executeCommand(command.command, command.args, cwd)

    let rawOutput = result.stdout
    if (command.outputMode === 'file') {
      try {
        rawOutput = await readFile(outputFilePath, 'utf8')
      } catch {
        rawOutput = result.stdout
      }
    }

    const profile = parseTaskProfile(rawOutput, requirement, availableTags)

    if (profile.title.length === 0 && result.exitCode !== 0) {
      throw new Error(`Task title generation failed: ${result.stderr}`)
    }

    return {
      title: profile.title,
      priority: profile.priority,
      tags: profile.tags,
      provider: command.provider,
      effectiveModel: command.effectiveModel,
    }
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }

    throw new Error(`Task title generation failed: ${toErrorMessage(error)}`, {
      cause: error,
    })
  } finally {
    await rm(outputFilePath, { force: true })
  }
}
