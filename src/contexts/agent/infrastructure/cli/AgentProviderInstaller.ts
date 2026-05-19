import { spawn } from 'node:child_process'
import process from 'node:process'
import type {
  AgentProviderId,
  InstallAgentProviderResult,
  AgentProviderAvailability,
} from '@shared/contracts/dto'
import { isValidProvider } from '../../../../contexts/settings/domain/agentSettings.providers'
import { getCommandEnvironmentSnapshot } from '../../../../platform/os/CommandEnvironmentService'
import { buildAdditionalPathSegments } from '../../../../platform/os/CliEnvironment'
import { mergeCommandPath } from '../../../../platform/os/CommandPathSegments'
import { resolveHomeDirectory } from '../../../../platform/os/HomeDirectory'
import { locateExecutable } from '../../../../platform/process/ExecutableLocator'
import { createAppError } from '../../../../shared/errors/appError'
import {
  disposeAgentExecutableResolver,
  resolveAgentProviderAvailability,
} from './AgentExecutableResolver'
import { resolveAgentCliCommand } from './AgentCommandFactory'
import { resolveAgentCliInvocation } from './AgentCliInvocation'

const INSTALL_TIMEOUT_MS = 120_000
const MAX_CAPTURED_OUTPUT_LENGTH = 16_000

const AGENT_PROVIDER_NPM_PACKAGES: Record<AgentProviderId, string> = {
  'claude-code': '@anthropic-ai/claude-code',
  codex: '@openai/codex',
  opencode: 'opencode-ai',
  gemini: '@google/gemini-cli',
}

interface CommandOutput {
  stdout: string
  stderr: string
}

function appendCapturedOutput(current: string, chunk: Buffer | string): string {
  const next = current + chunk.toString()
  if (next.length <= MAX_CAPTURED_OUTPUT_LENGTH) {
    return next
  }

  return next.slice(next.length - MAX_CAPTURED_OUTPUT_LENGTH)
}

function normalizeOutput(value: string): string {
  return value.trim()
}

async function runInstallCommand(options: {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
}): Promise<CommandOutput> {
  return await new Promise((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timeout = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // Best-effort cleanup only.
      }

      if (!settled) {
        settled = true
        reject(
          createAppError('common.unavailable', {
            debugMessage: `npm install timed out after ${INSTALL_TIMEOUT_MS}ms.`,
          }),
        )
      }
    }, INSTALL_TIMEOUT_MS)

    const finish = (fn: () => void): void => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      fn()
    }

    child.stdout.on('data', chunk => {
      stdout = appendCapturedOutput(stdout, chunk)
    })

    child.stderr.on('data', chunk => {
      stderr = appendCapturedOutput(stderr, chunk)
    })

    child.on('error', error => {
      finish(() => reject(error))
    })

    child.on('close', exitCode => {
      finish(() => {
        const normalizedStdout = normalizeOutput(stdout)
        const normalizedStderr = normalizeOutput(stderr)

        if (exitCode === 0) {
          resolve({ stdout: normalizedStdout, stderr: normalizedStderr })
          return
        }

        reject(
          createAppError('common.unavailable', {
            details: {
              stdout: normalizedStdout,
              stderr: normalizedStderr,
              exitCode,
            },
            debugMessage:
              normalizedStderr.length > 0
                ? normalizedStderr
                : `npm install exited with code ${exitCode ?? 'unknown'}.`,
          }),
        )
      })
    })
  })
}

async function resolveNpmCommand(): Promise<{
  command: string
  env: NodeJS.ProcessEnv
}> {
  const homeDir = resolveHomeDirectory()
  const commandEnvironment = await getCommandEnvironmentSnapshot()
  const fallbackDirectories = buildAdditionalPathSegments(process.platform, homeDir)
  const resolved = await locateExecutable({
    toolId: 'npm',
    command: 'npm',
    fallbackDirectories,
  })

  if (!resolved.executablePath) {
    throw createAppError('common.unavailable', {
      details: { diagnostics: resolved.diagnostics },
      debugMessage: resolved.diagnostics.join(' '),
    })
  }

  return {
    command: resolved.executablePath,
    env: {
      ...commandEnvironment.env,
      PATH: mergeCommandPath({
        platform: process.platform,
        currentPath: commandEnvironment.env.PATH ?? '',
        homeDir,
        env: commandEnvironment.env,
      }),
    },
  }
}

function buildInstallArgs(packageName: string): string[] {
  return ['install', '--global', packageName]
}

function assertInstalled(provider: AgentProviderId, availability: AgentProviderAvailability): void {
  if (availability.status === 'available') {
    return
  }

  const diagnostics = availability.diagnostics.join(' ')
  throw createAppError('common.unavailable', {
    details: { availability },
    debugMessage:
      diagnostics.length > 0
        ? diagnostics
        : `Installed package but ${resolveAgentCliCommand(provider)} was not found.`,
  })
}

export function resolveAgentProviderInstallPackage(provider: AgentProviderId): string {
  if (!isValidProvider(provider)) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid agent provider install request: ${String(provider)}`,
    })
  }

  return AGENT_PROVIDER_NPM_PACKAGES[provider]
}

export async function installAgentProvider(
  provider: AgentProviderId,
): Promise<InstallAgentProviderResult> {
  const packageName = resolveAgentProviderInstallPackage(provider)
  const npm = await resolveNpmCommand()
  const invocation = await resolveAgentCliInvocation({
    command: npm.command,
    args: buildInstallArgs(packageName),
  })
  const output = await runInstallCommand({
    command: invocation.command,
    args: invocation.args,
    env: npm.env,
  })

  disposeAgentExecutableResolver()
  const availability = await resolveAgentProviderAvailability({ provider })
  assertInstalled(provider, availability)

  return {
    provider,
    packageName,
    availability,
    stdout: output.stdout,
    stderr: output.stderr,
  }
}
