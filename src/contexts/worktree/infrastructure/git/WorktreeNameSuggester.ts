import { spawn } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isWorktreeNameSuggestionProvider } from '../../../settings/domain/agentSettings'
import type {
  SuggestWorktreeNamesInput,
  SuggestWorktreeNamesResult,
} from '../../../../shared/contracts/dto'
import { buildWorktreeNameSuggestionCommand } from './WorktreeNameSuggestionCommandFactory'

const SUGGEST_TIMEOUT_MS = 30_000
const MAX_NAME_LENGTH = 72

interface CommandExecutionResult {
  exitCode: number
  stdout: string
  stderr: string
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

function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/['"`]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-/]+|[-/]+$/g, '')

  return normalized.slice(0, MAX_NAME_LENGTH)
}

function normalizeWorktreeName(raw: string, fallback: string): string {
  const normalized = slugify(raw)
  return normalized.length > 0 ? normalized : fallback
}

function normalizeBranchName(raw: string, fallback: string): string {
  const normalized = slugify(raw)

  const withPrefix = normalized.includes('/') ? normalized : `space/${normalized}`
  const candidate = withPrefix.replace(/^\/+/, '').slice(0, MAX_NAME_LENGTH)

  return candidate.length > 0 ? candidate : fallback
}

function buildPrompt(input: SuggestWorktreeNamesInput): string {
  const tasksText =
    input.tasks.length > 0
      ? input.tasks
          .slice(0, 12)
          .map(task => {
            const title = task.title.trim()
            const requirement = task.requirement.trim()
            const headline = title.length > 0 ? title : (requirement.split(/\r?\n/)[0] ?? '')
            return `- ${headline}`.trim()
          })
          .join('\n')
      : '- (none)'

  const notes = input.spaceNotes?.trim() ? input.spaceNotes.trim() : '(none)'

  return [
    'You are a naming assistant for git worktrees.',
    'Generate a JSON object with branchName and worktreeName.',
    'Output rules:',
    '- Return exactly one JSON object. No markdown, no extra text.',
    '- Keys must be: branchName, worktreeName.',
    '- branchName: valid git branch name, prefer lowercase ascii, use "/" to group, <= 72 chars.',
    '- worktreeName: safe directory name, lowercase ascii, "-", "_" allowed, <= 72 chars.',
    '',
    `Space name: ${input.spaceName}`,
    `Space notes: ${notes}`,
    '',
    'Tasks:',
    tasksText,
  ].join('\n')
}

function parseFirstJsonObject(rawOutput: string): { branchName: string; worktreeName: string } {
  const firstObjectMatch = rawOutput.match(/\{[\s\S]*\}/)
  const candidate = firstObjectMatch ? firstObjectMatch[0] : rawOutput

  try {
    const parsed = JSON.parse(candidate) as { branchName?: unknown; worktreeName?: unknown }
    return {
      branchName: typeof parsed.branchName === 'string' ? parsed.branchName : '',
      worktreeName: typeof parsed.worktreeName === 'string' ? parsed.worktreeName : '',
    }
  } catch {
    return {
      branchName: '',
      worktreeName: '',
    }
  }
}

function testModeSuggestion(input: SuggestWorktreeNamesInput): SuggestWorktreeNamesResult {
  const slug = slugify(input.spaceName) || 'space'
  return {
    branchName: `space/${slug}`,
    worktreeName: slug,
    provider: input.provider,
    effectiveModel: input.model ?? null,
  }
}

async function executeCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<CommandExecutionResult> {
  return await new Promise((resolvePromise, reject) => {
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
    }, SUGGEST_TIMEOUT_MS)

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
        reject(new Error('Worktree name suggestion timed out'))
        return
      }

      resolvePromise({
        exitCode: typeof exitCode === 'number' ? exitCode : 1,
        stdout,
        stderr,
      })
    })
  })
}

export async function suggestWorktreeNames(
  input: SuggestWorktreeNamesInput,
): Promise<SuggestWorktreeNamesResult> {
  const cwd = input.cwd.trim()
  const spaceName = input.spaceName.trim()

  if (cwd.length === 0) {
    throw new Error('Worktree name suggestion requires cwd')
  }

  if (spaceName.length === 0) {
    throw new Error('Worktree name suggestion requires spaceName')
  }

  if (process.env.NODE_ENV === 'test') {
    return testModeSuggestion(input)
  }

  if (!isWorktreeNameSuggestionProvider(input.provider)) {
    throw new Error(`Worktree name suggestion does not support provider: ${input.provider}`)
  }

  const prompt = buildPrompt(input)
  const outputFilePath = join(tmpdir(), `cove-worktree-names-${crypto.randomUUID()}.txt`)

  const command = buildWorktreeNameSuggestionCommand({
    provider: input.provider,
    prompt,
    model: input.model ?? null,
    outputFilePath,
  })

  const fallbackSlug = slugify(spaceName) || `space-${crypto.randomUUID().slice(0, 8)}`
  const fallbackBranch = `space/${fallbackSlug}`

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

    const parsed = parseFirstJsonObject(rawOutput)
    const branchName = normalizeBranchName(parsed.branchName, fallbackBranch)
    const worktreeName = normalizeWorktreeName(parsed.worktreeName, fallbackSlug)

    if (result.exitCode !== 0 && branchName.length === 0 && worktreeName.length === 0) {
      throw new Error(`Worktree name suggestion failed: ${result.stderr}`)
    }

    return {
      branchName,
      worktreeName,
      provider: command.provider,
      effectiveModel: command.effectiveModel,
    }
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }

    throw new Error(`Worktree name suggestion failed: ${toErrorMessage(error)}`, {
      cause: error,
    })
  } finally {
    await rm(outputFilePath, { force: true })
  }
}
