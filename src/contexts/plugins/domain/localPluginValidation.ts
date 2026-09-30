import type { LocalPluginPackage } from './pluginRuntimeTypes'
import type { PluginIconDeclaration } from './pluginTypes'

export function pluginRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a plugin object.')
  }
  return value as Record<string, unknown>
}

export function pluginString(value: unknown, field: string, max = 512): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(`Invalid plugin ${field}.`)
  }
  return value.trim()
}

export function pluginRelativePath(value: unknown, field = 'path'): string {
  const path = pluginString(value, field, 1024).replace(/^\.\//, '')
  if (
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').some(part => !part || part === '.' || part === '..') ||
    /^[a-z]:/i.test(path)
  ) {
    throw new Error(`Plugin ${field} must be a relative path inside its directory.`)
  }
  return path
}

function dimension(value: unknown, fallback: number): number {
  if (value === undefined) {
    return fallback
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 100 || value > 4000) {
    throw new Error('Plugin window dimensions must be between 100 and 4000.')
  }
  return Math.round(value)
}

function icon(value: unknown): PluginIconDeclaration | undefined {
  if (value === undefined) {
    return undefined
  }
  const source = pluginRecord(value)
  if (source.type === 'builtin' && (source.name === 'puzzle' || source.name === 'git-branch')) {
    return { type: 'builtin', name: source.name }
  }
  if (source.type !== 'asset') {
    throw new Error('Invalid plugin icon declaration.')
  }
  const asset = (candidate: unknown): string => {
    const path = pluginRelativePath(candidate, 'icon')
    if (!/\.(svg|png|webp)$/i.test(path)) {
      throw new Error('Plugin icons must be SVG, PNG or WebP.')
    }
    return `./${path}`
  }
  return {
    type: 'asset',
    path: asset(source.path),
    ...(source.light === undefined ? {} : { light: asset(source.light) }),
    ...(source.dark === undefined ? {} : { dark: asset(source.dark) }),
  }
}

export function normalizeLocalPluginPackage(value: unknown): LocalPluginPackage {
  const raw = pluginRecord(value)
  if (raw.apiVersion !== 1) {
    throw new Error('Unsupported plugin apiVersion; this build requires 1.')
  }
  const id = pluginString(raw.id, 'id', 80)
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new Error('Plugin id must use lowercase letters, digits and hyphens.')
  }
  const version = pluginString(raw.version, 'version', 80)
  if (!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version)) {
    throw new Error('Invalid plugin version.')
  }
  const view = pluginRecord(raw.view)
  const minWidth = dimension(view.minWidth, 320)
  const minHeight = dimension(view.minHeight, 220)
  const contributes = raw.contributes === undefined ? {} : pluginRecord(raw.contributes)
  for (const key of ['actionBar', 'contextMenu']) {
    if (contributes[key] !== undefined && typeof contributes[key] !== 'boolean') {
      throw new Error(`Plugin contributes.${key} must be a boolean.`)
    }
  }
  if (
    raw.platforms !== undefined &&
    (!Array.isArray(raw.platforms) ||
      !raw.platforms.length ||
      raw.platforms.some(item => !['darwin', 'linux', 'win32'].includes(String(item))))
  ) {
    throw new Error('Plugin platforms must contain darwin, linux or win32.')
  }
  const entry = pluginRelativePath(view.entry, 'view.entry')
  if (!/\.html?$/i.test(entry)) {
    throw new Error('Plugin view.entry must be HTML.')
  }
  const main = raw.main === undefined ? undefined : pluginRelativePath(raw.main, 'main')
  if (main && !/\.(mjs|js|cjs)$/i.test(main)) {
    throw new Error('Plugin main must be a JavaScript module.')
  }
  return {
    apiVersion: 1,
    id,
    version,
    displayName: pluginString(raw.displayName, 'displayName', 120),
    description: pluginString(raw.description, 'description', 2000),
    ...(raw.author === undefined ? {} : { author: pluginString(raw.author, 'author', 200) }),
    icon: icon(raw.icon),
    main,
    view: {
      entry,
      minWidth,
      minHeight,
      width: Math.max(minWidth, dimension(view.width, 640)),
      height: Math.max(minHeight, dimension(view.height, 440)),
    },
    ...(raw.preview === undefined ? {} : { preview: pluginRelativePath(raw.preview, 'preview') }),
    ...(raw.readme === undefined ? {} : { readme: pluginRelativePath(raw.readme, 'readme') }),
    contributes: {
      actionBar: contributes.actionBar !== false,
      contextMenu: contributes.contextMenu !== false,
    },
    ...(raw.platforms === undefined
      ? {}
      : { platforms: raw.platforms as LocalPluginPackage['platforms'] }),
  }
}
