import { PLUGIN_THEME_TOKENS, PLUGIN_THEME_BASES, type PluginThemeBase } from './pluginThemeTypes'
import { normalizePluginThemeMetrics, normalizePluginThemeTypography } from './pluginThemeMetrics'
import { normalizePluginThemeMotion } from './pluginThemeMotion'
import type {
  PluginPreferenceDeclaration,
  PluginPreferenceValue,
  PluginThemeDeclaration,
  PluginThemeToken,
} from './pluginTypes'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid plugin contribution.')
  }
  return value as Record<string, unknown>
}
function text(value: unknown, maximum = 120): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error('Invalid plugin contribution text.')
  }
  return value.trim()
}
function list<T extends { id: string }>(
  value: unknown,
  normalize: (raw: Record<string, unknown>) => T,
): T[] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error('Invalid plugin contribution list.')
  }
  const ids = new Set<string>()
  return value.map(item => {
    const result = normalize(object(item))
    if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(result.id) || ids.has(result.id)) {
      throw new Error('Invalid or duplicate plugin contribution id.')
    }
    ids.add(result.id)
    return result
  })
}
export function isPluginPreferenceValue(
  schema: PluginPreferenceDeclaration,
  value: unknown,
): value is PluginPreferenceValue {
  return (
    typeof value === schema.type &&
    (typeof value !== 'string' || value.length <= 4000) &&
    (typeof value !== 'number' ||
      (Number.isFinite(value) &&
        (schema.minimum === undefined || value >= schema.minimum) &&
        (schema.maximum === undefined || value <= schema.maximum))) &&
    (!schema.enum || schema.enum.includes(value as PluginPreferenceValue))
  )
}
export function normalizePluginPreferences(value: unknown): PluginPreferenceDeclaration[] {
  return list(value, raw => {
    if (!['string', 'number', 'boolean'].includes(String(raw.type))) {
      throw new Error('Invalid plugin preference type.')
    }
    const schema: PluginPreferenceDeclaration = {
      id: text(raw.id, 80),
      title: text(raw.title),
      type: raw.type as PluginPreferenceDeclaration['type'],
      default: raw.default as PluginPreferenceValue,
    }
    if (raw.description !== undefined) {
      schema.description = text(raw.description, 2000)
    }
    for (const bound of ['minimum', 'maximum'] as const) {
      if (raw[bound] !== undefined) {
        if (
          schema.type !== 'number' ||
          typeof raw[bound] !== 'number' ||
          !Number.isFinite(raw[bound])
        ) {
          throw new Error('Invalid plugin preference bounds.')
        }
        schema[bound] = raw[bound]
      }
    }
    if (
      schema.minimum !== undefined &&
      schema.maximum !== undefined &&
      schema.minimum > schema.maximum
    ) {
      throw new Error('Invalid plugin preference bounds.')
    }
    if (raw.enum !== undefined) {
      if (
        !Array.isArray(raw.enum) ||
        !raw.enum.length ||
        raw.enum.length > 100 ||
        raw.enum.some(item => !isPluginPreferenceValue(schema, item)) ||
        new Set(raw.enum).size !== raw.enum.length
      ) {
        throw new Error('Invalid plugin preference enum.')
      }
      schema.enum = raw.enum as PluginPreferenceValue[]
    }
    if (!isPluginPreferenceValue(schema, schema.default)) {
      throw new Error('Invalid plugin preference default.')
    }
    return schema
  })
}
export function normalizePluginThemes(value: unknown): PluginThemeDeclaration[] {
  return list(value, raw => {
    if (raw.appearance !== 'light' && raw.appearance !== 'dark') {
      throw new Error('Plugin theme appearance must be light or dark.')
    }
    const base = raw.extends
    if (base !== undefined && !(PLUGIN_THEME_BASES as readonly unknown[]).includes(base)) {
      throw new Error('Plugin theme extends must name a built-in visual foundation.')
    }
    if (
      base !== undefined &&
      (String(base).endsWith('light') ? 'light' : 'dark') !== raw.appearance
    ) {
      throw new Error('Plugin theme appearance must match its visual foundation.')
    }
    const entries = Object.entries(raw.tokens === undefined ? {} : object(raw.tokens))
    if (
      entries.some(
        ([key, tokenValue]) =>
          !(PLUGIN_THEME_TOKENS as readonly string[]).includes(key) ||
          typeof tokenValue !== 'string' ||
          !tokenValue.trim() ||
          tokenValue.length > 2000 ||
          /[;{}<>]|url\s*\(|!important|@import/i.test(tokenValue),
      )
    ) {
      throw new Error(
        'Plugin themes require supported tokens with single CSS values; put assets in a stylesheet.',
      )
    }
    let stylesheet: string | undefined
    if (raw.stylesheet !== undefined) {
      stylesheet = text(raw.stylesheet, 240).replace(/^\.\//, '')
      if (
        !/\.css$/i.test(stylesheet) ||
        stylesheet.startsWith('/') ||
        stylesheet.includes('\0') ||
        /[\\?#:]/.test(stylesheet) ||
        stylesheet.split('/').some(part => !part || part === '.' || part === '..')
      ) {
        throw new Error('Plugin theme stylesheet must be a package-relative CSS file.')
      }
    }
    const typography = normalizePluginThemeTypography(raw.typography)
    const metrics = normalizePluginThemeMetrics(raw.metrics)
    const motion = normalizePluginThemeMotion(raw.motion)
    if (!base && !entries.length && !stylesheet && !typography && !metrics && !motion) {
      throw new Error('Plugin theme requires a foundation or visual contribution.')
    }
    return {
      id: text(raw.id, 80),
      title: text(raw.title),
      appearance: raw.appearance,
      ...(base ? { extends: base as PluginThemeBase } : {}),
      tokens: Object.fromEntries(entries) as Partial<Record<PluginThemeToken, string>>,
      ...(stylesheet ? { stylesheet } : {}),
      ...(typography ? { typography } : {}),
      ...(metrics ? { metrics } : {}),
      ...(motion ? { motion } : {}),
    }
  })
}
