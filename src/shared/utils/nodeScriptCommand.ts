import { basename } from 'node:path'

export interface NodeScriptLaunchCommand {
  command: string
  args: string[]
  env?: Record<string, string>
}

function normalizeOptionalCommand(value: string | undefined): string | null {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : null
}

function isLikelyNodeExecutable(command: string): boolean {
  const executableName = basename(command).toLowerCase()
  return (
    executableName === 'node' ||
    executableName === 'node.exe' ||
    executableName === 'nodejs' ||
    executableName === 'nodejs.exe'
  )
}

export function resolveNodeScriptLaunch(
  scriptPath: string,
  scriptArgs: string[],
  options?: {
    env?: NodeJS.ProcessEnv
    execPath?: string
  },
): NodeScriptLaunchCommand {
  const env = options?.env ?? process.env
  const execPath = options?.execPath ?? process.execPath
  const explicitOverride = normalizeOptionalCommand(env['OPENCOVE_TEST_NODE_EXECUTABLE'])
  if (explicitOverride) {
    return {
      command: explicitOverride,
      args: [scriptPath, ...scriptArgs],
    }
  }

  if (isLikelyNodeExecutable(execPath)) {
    return {
      command: execPath,
      args: [scriptPath, ...scriptArgs],
    }
  }

  return {
    command: execPath,
    args: [scriptPath, ...scriptArgs],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
    },
  }
}
