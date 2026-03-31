import path from 'node:path'
import { spawnSync } from 'node:child_process'

export interface MacUpdaterSupportResult {
  supported: boolean
  message: string | null
  designatedRequirement: string | null
}

export function extractDesignatedRequirement(codesignOutput: string): string | null {
  const match = codesignOutput.match(/\bdesignated\s*=>\s*(.+)$/m)
  return match?.[1]?.trim() ?? null
}

export function isAdhocDesignatedRequirement(designatedRequirement: string): boolean {
  return /^cdhash\b/i.test(designatedRequirement.trim())
}

export function resolveMacAppBundlePath(executablePath: string): string {
  let candidate = executablePath

  for (let index = 0; index < 5; index += 1) {
    if (candidate.endsWith('.app')) {
      return candidate
    }

    const next = path.dirname(candidate)
    if (next === candidate) {
      break
    }

    candidate = next
  }

  return executablePath
}

export function resolveMacUpdaterSupport(options: {
  appPath: string
  platform?: NodeJS.Platform
  spawn?: typeof spawnSync
}): MacUpdaterSupportResult {
  const platform = options.platform ?? process.platform
  if (platform !== 'darwin') {
    return { supported: true, message: null, designatedRequirement: null }
  }

  const spawn = options.spawn ?? spawnSync
  const result = spawn('codesign', ['-dr', '-', options.appPath], { encoding: 'utf8' })

  if (result.error) {
    return {
      supported: false,
      message:
        'macOS in-app updates require a signed build, but code signature validation is unavailable on this system.（macOS 自动更新需要签名，但当前系统无法验证签名。）',
      designatedRequirement: null,
    }
  }

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  const designatedRequirement = extractDesignatedRequirement(output)

  if (result.status !== 0) {
    return {
      supported: false,
      message:
        'macOS in-app updates require a signed build. This build is not properly signed; download the latest release manually.（macOS 自动更新需要签名；当前构建未正确签名，请手动下载安装最新版本。）',
      designatedRequirement,
    }
  }

  if (!designatedRequirement) {
    return {
      supported: false,
      message:
        'macOS in-app updates require a stable code signature. This build does not expose one; download the latest release manually.（macOS 自动更新需要稳定的代码签名；当前构建没有可用的签名要求，请手动下载安装最新版本。）',
      designatedRequirement: null,
    }
  }

  if (isAdhocDesignatedRequirement(designatedRequirement)) {
    return {
      supported: false,
      message:
        'macOS in-app updates require a Developer ID signature. This build is ad-hoc signed, so updates are disabled; download the latest release manually.（macOS 自动更新需要 Developer ID 签名；当前为 ad-hoc 签名构建，已禁用更新检查，请手动下载安装最新版本。）',
      designatedRequirement,
    }
  }

  return { supported: true, message: null, designatedRequirement }
}
