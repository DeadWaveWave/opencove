import { normalizePluginSidebar } from './pluginSidebar'
import { normalizePluginPreferences, normalizePluginThemes } from './pluginHostExtensionValidation'
import { normalizePluginEngines } from './pluginCompatibility'
import type { LocalPluginPackage } from './pluginRuntimeTypes'
import type {
  PluginCommandDeclaration,
  PluginCommandMenu,
  PluginIconDeclaration,
  PluginSkillDeclaration,
} from './pluginTypes'

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

function declarations<T>(
  value: unknown,
  field: string,
  normalize: (item: Record<string, unknown>) => T & { id: string },
): T[] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error(`Plugin ${field} must be an array of at most 100 declarations.`)
  }
  const ids = new Set<string>()
  return value.map(item => {
    const declaration = normalize(pluginRecord(item))
    if (ids.has(declaration.id)) {
      throw new Error(`Duplicate plugin ${field} id: ${declaration.id}`)
    }
    ids.add(declaration.id)
    return declaration
  })
}

function declarationId(value: unknown, field: string): string {
  const id = pluginString(value, `${field} id`, 80)
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(id)) {
    throw new Error(`Plugin ${field} id must use lowercase letters, digits, dots and hyphens.`)
  }
  return id
}

function command(value: Record<string, unknown>): PluginCommandDeclaration {
  if (value.target !== 'plugin' && value.target !== 'window') {
    throw new Error('Plugin command target must be plugin or window.')
  }
  const menus = value.menus
  if (
    menus !== undefined &&
    (!Array.isArray(menus) ||
      menus.length > 5 ||
      menus.some(
        item => !['commandCenter', 'canvas', 'node', 'space', 'sidebar'].includes(String(item)),
      ) ||
      new Set(menus).size !== menus.length)
  ) {
    throw new Error('Invalid plugin command menus.')
  }
  if (value.target === 'window' && Array.isArray(menus) && menus.includes('sidebar')) {
    throw new Error('Sidebar actions require a backend command.')
  }
  return {
    ...(menus === undefined ? {} : { menus: menus as PluginCommandMenu[] }),
    id: declarationId(value.id, 'command'),
    title: pluginString(value.title, 'command title', 120),
    description: pluginString(value.description, 'command description', 2000),
    target: value.target,
    ...(value.usage === undefined
      ? {}
      : { usage: pluginString(value.usage, 'command usage', 2000) }),
  }
}

function skill(value: Record<string, unknown>): PluginSkillDeclaration {
  const path = pluginRelativePath(value.path, 'skill path')
  if (path.split('/').at(-1) !== 'SKILL.md') {
    throw new Error('Plugin skill path must name a SKILL.md file.')
  }
  return {
    id: declarationId(value.id, 'skill'),
    description: pluginString(value.description, 'skill description', 1024),
    path,
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
  const view = raw.view === undefined ? undefined : pluginRecord(raw.view)
  const minWidth = dimension(view?.minWidth, 320)
  const minHeight = dimension(view?.minHeight, 220)
  const contributes = raw.contributes === undefined ? {} : pluginRecord(raw.contributes)
  for (const key of ['actionBar', 'contextMenu']) {
    if (contributes[key] !== undefined && typeof contributes[key] !== 'boolean') {
      throw new Error(`Plugin contributes.${key} must be a boolean.`)
    }
  }
  const commands = declarations(contributes.commands, 'commands', command)
  const skills = declarations(contributes.skills, 'skills', skill)
  const preferences = normalizePluginPreferences(contributes.preferences)
  const themes = normalizePluginThemes(contributes.themes)
  const sidebar = normalizePluginSidebar(contributes.sidebar, commands)
  if (
    !view &&
    (raw.preview !== undefined ||
      contributes.actionBar === true ||
      contributes.contextMenu === true)
  ) {
    throw new Error('Plugin preview and window contributions require a view.')
  }
  if (!view && commands.some(item => item.target === 'window')) {
    throw new Error('Plugin window commands require a view.')
  }
  if (commands.some(item => item.target === 'plugin') && raw.main === undefined) {
    throw new Error('Plugin commands targeting the plugin require a main backend.')
  }
  if (
    !view &&
    commands.length === 0 &&
    skills.length === 0 &&
    preferences.length === 0 &&
    themes.length === 0
  ) {
    throw new Error('Plugin must provide a view, command, skill, preference or theme.')
  }
  if (view?.instances !== undefined && !['single', 'multiple'].includes(String(view.instances))) {
    throw new Error('Plugin view.instances must be single or multiple.')
  }
  if (
    raw.platforms !== undefined &&
    (!Array.isArray(raw.platforms) ||
      !raw.platforms.length ||
      raw.platforms.some(item => !['darwin', 'linux', 'win32'].includes(String(item))))
  ) {
    throw new Error('Plugin platforms must contain darwin, linux or win32.')
  }
  const entry = view ? pluginRelativePath(view.entry, 'view.entry') : undefined
  if (entry && !/\.html?$/i.test(entry)) {
    throw new Error('Plugin view.entry must be HTML.')
  }
  const main = raw.main === undefined ? undefined : pluginRelativePath(raw.main, 'main')
  const engines = normalizePluginEngines(raw.engines)
  if (main && !/\.(mjs|js|cjs)$/i.test(main)) {
    throw new Error('Plugin main must be a JavaScript module.')
  }
  return {
    apiVersion: 1,
    id,
    version,
    ...(engines ? { engines } : {}),
    displayName: pluginString(raw.displayName, 'displayName', 120),
    description: pluginString(raw.description, 'description', 2000),
    ...(raw.author === undefined ? {} : { author: pluginString(raw.author, 'author', 200) }),
    icon: icon(raw.icon),
    main,
    ...(view && entry
      ? {
          view: {
            entry,
            instances: (view.instances ?? 'multiple') as 'single' | 'multiple',
            minWidth,
            minHeight,
            width: Math.max(minWidth, dimension(view.width, 640)),
            height: Math.max(minHeight, dimension(view.height, 440)),
          },
        }
      : {}),
    ...(raw.preview === undefined ? {} : { preview: pluginRelativePath(raw.preview, 'preview') }),
    ...(raw.readme === undefined ? {} : { readme: pluginRelativePath(raw.readme, 'readme') }),
    contributes: {
      actionBar: Boolean(view) && contributes.actionBar !== false,
      contextMenu: Boolean(view) && contributes.contextMenu !== false,
      commands,
      skills,
      preferences,
      themes,
      sidebar,
    },
    ...(raw.platforms === undefined
      ? {}
      : { platforms: raw.platforms as LocalPluginPackage['platforms'] }),
  }
}
