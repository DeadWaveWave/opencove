import process from 'node:process'
import { getCommandEnvironmentSnapshot } from './CommandEnvironmentService'
import { mergeCommandPath } from './CommandPathSegments'
import { resolveHomeDirectory } from './HomeDirectory'
export { buildAdditionalPathSegments } from './CommandPathSegments'

interface ComputeHydratedCliPathInput {
  isPackaged: boolean
  platform: NodeJS.Platform
  currentPath: string
  homeDir: string
  shellPathFromLogin: string
  env?: NodeJS.ProcessEnv
}

interface ComputeHydratedLocaleEnvInput {
  isPackaged: boolean
  platform: NodeJS.Platform
  currentEnv: NodeJS.ProcessEnv
  loginShellEnv: Partial<Pick<NodeJS.ProcessEnv, 'LANG' | 'LC_ALL' | 'LC_CTYPE'>>
}

function isUtf8Locale(value: string | undefined): boolean {
  return typeof value === 'string' && /utf-?8/i.test(value)
}

function resolveEffectiveCharacterLocale(
  env: NodeJS.ProcessEnv | Partial<Pick<NodeJS.ProcessEnv, 'LANG' | 'LC_ALL' | 'LC_CTYPE'>>,
): string {
  const lcAll = env.LC_ALL?.trim()
  if (lcAll) {
    return lcAll
  }

  const lcCtype = env.LC_CTYPE?.trim()
  if (lcCtype) {
    return lcCtype
  }

  return env.LANG?.trim() ?? ''
}

function resolveUtf8LocaleFallback(platform: NodeJS.Platform): string {
  return platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8'
}

export function computeHydratedCliPath(input: ComputeHydratedCliPathInput): string {
  if (!input.isPackaged) {
    return input.currentPath
  }

  return mergeCommandPath({
    platform: input.platform,
    currentPath: input.currentPath,
    discoveredPath: input.shellPathFromLogin,
    homeDir: input.homeDir,
    env: input.env,
  })
}

export function computeHydratedLocaleEnv(
  input: ComputeHydratedLocaleEnvInput,
): Partial<Pick<NodeJS.ProcessEnv, 'LANG' | 'LC_ALL' | 'LC_CTYPE'>> {
  if (!input.isPackaged) {
    return {}
  }

  if (input.platform === 'win32') {
    return {}
  }

  if (isUtf8Locale(resolveEffectiveCharacterLocale(input.currentEnv))) {
    return {}
  }

  const loginShellLocale = resolveEffectiveCharacterLocale(input.loginShellEnv)
  const targetLocale = isUtf8Locale(loginShellLocale)
    ? loginShellLocale
    : resolveUtf8LocaleFallback(input.platform)

  const nextEnv: Partial<Pick<NodeJS.ProcessEnv, 'LANG' | 'LC_ALL' | 'LC_CTYPE'>> = {
    LANG: isUtf8Locale(input.loginShellEnv.LANG) ? input.loginShellEnv.LANG : targetLocale,
    LC_CTYPE: isUtf8Locale(input.loginShellEnv.LC_CTYPE)
      ? input.loginShellEnv.LC_CTYPE
      : targetLocale,
  }

  if (input.currentEnv.LC_ALL?.trim()) {
    nextEnv.LC_ALL = isUtf8Locale(input.loginShellEnv.LC_ALL)
      ? input.loginShellEnv.LC_ALL
      : targetLocale
  }

  return nextEnv
}

export async function hydrateCliEnvironmentForAppLaunch(isPackaged: boolean): Promise<void> {
  if (!isPackaged) {
    return
  }

  const currentPath = process.env.PATH ?? ''
  const commandEnvironment = await getCommandEnvironmentSnapshot()
  const shellPathFromLogin = process.platform !== 'win32' ? (commandEnvironment.env.PATH ?? '') : ''
  const loginShellLocaleEnv =
    process.platform !== 'win32'
      ? {
          LANG: commandEnvironment.env.LANG,
          LC_ALL: commandEnvironment.env.LC_ALL,
          LC_CTYPE: commandEnvironment.env.LC_CTYPE,
        }
      : {}

  const applyHydratedLocaleEnv = (): void => {
    const nextLocaleEnv = computeHydratedLocaleEnv({
      isPackaged,
      platform: process.platform,
      currentEnv: process.env,
      loginShellEnv: loginShellLocaleEnv,
    })

    if (nextLocaleEnv.LANG) {
      process.env.LANG = nextLocaleEnv.LANG
    }
    if (nextLocaleEnv.LC_CTYPE) {
      process.env.LC_CTYPE = nextLocaleEnv.LC_CTYPE
    }
    if (nextLocaleEnv.LC_ALL) {
      process.env.LC_ALL = nextLocaleEnv.LC_ALL
    }
  }

  const nextPath = computeHydratedCliPath({
    isPackaged,
    platform: process.platform,
    currentPath,
    homeDir: resolveHomeDirectory(),
    shellPathFromLogin,
  })

  if (nextPath.trim().length === 0 || nextPath === currentPath) {
    applyHydratedLocaleEnv()
    return
  }

  process.env.PATH = nextPath
  applyHydratedLocaleEnv()
}
