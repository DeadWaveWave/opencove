/** Visual metrics never replace persisted canvas geometry or terminal font settings. */
export interface PluginThemeTypography {
  fontFamily?: string
  fontSize?: number
  titleFontSize?: number
}

export interface PluginThemeMetrics {
  headerHeight?: number
  headerPadding?: number
  iconSize?: number
  compactIconSize?: number
  controlGap?: number
  menuRowHeight?: number
  sidebarRowHeight?: number
  controlHeight?: number
  radius?: number
}

const METRICS = {
  headerHeight: ['--cove-node-header-height', 30, 64],
  headerPadding: ['--cove-node-header-padding-inline', 4, 24],
  iconSize: ['--cove-node-icon-size', 12, 24],
  compactIconSize: ['--cove-compact-icon-size', 16, 36],
  controlGap: ['--cove-control-gap', 2, 16],
  menuRowHeight: ['--cove-menu-row-height', 28, 48],
  sidebarRowHeight: ['--cove-sidebar-row-height', 28, 48],
  controlHeight: ['--cove-control-height-md', 28, 48],
  radius: ['--cove-node-radius', 0, 24],
} as const

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid plugin theme metrics.')
  }
  return value as Record<string, unknown>
}

function number(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`Plugin theme metric must be between ${minimum} and ${maximum}.`)
  }
  return value
}

export function normalizePluginThemeMetrics(value: unknown): PluginThemeMetrics | undefined {
  if (value === undefined) {
    return undefined
  }
  const source = record(value)
  const result: PluginThemeMetrics = {}
  for (const [key, raw] of Object.entries(source)) {
    if (!Object.hasOwn(METRICS, key)) {
      throw new Error(`Unknown plugin theme metric: ${key}.`)
    }
    const name = key as keyof PluginThemeMetrics
    const [, min, max] = METRICS[name]
    result[name] = number(raw, min, max)
  }
  return result
}

export function normalizePluginThemeTypography(value: unknown): PluginThemeTypography | undefined {
  if (value === undefined) {
    return undefined
  }
  const source = record(value)
  const result: PluginThemeTypography = {}
  for (const [key, raw] of Object.entries(source)) {
    if (key === 'fontFamily') {
      if (typeof raw !== 'string' || !raw.trim() || raw.length > 300 || /[;{}<>\n\r\\]/.test(raw)) {
        throw new Error('Invalid plugin theme font family.')
      }
      result.fontFamily = raw.trim()
    } else if (key === 'fontSize') {
      result.fontSize = number(raw, 12, 22)
    } else if (key === 'titleFontSize') {
      result.titleFontSize = number(raw, 10, 18)
    } else {
      throw new Error(`Unknown plugin theme typography: ${key}.`)
    }
  }
  return result
}

export function pluginThemeMetricTokens(theme: {
  typography?: PluginThemeTypography
  metrics?: PluginThemeMetrics
}): Record<string, string> {
  const tokens: Record<string, string> = {}
  for (const [key, value] of Object.entries(theme.metrics ?? {})) {
    const [token] = METRICS[key as keyof PluginThemeMetrics]
    tokens[token] = `${value}px`
  }
  if (theme.metrics?.radius !== undefined) {
    tokens['--cove-explorer-radius'] = `${theme.metrics.radius}px`
  }
  if (theme.typography?.fontFamily) {
    tokens['--cove-font-ui'] = theme.typography.fontFamily
  }
  if (theme.typography?.fontSize !== undefined) {
    tokens['--cove-theme-font-scale'] = String(theme.typography.fontSize / 16)
  }
  if (theme.typography?.titleFontSize !== undefined) {
    tokens['--cove-node-title-font-size'] = `${theme.typography.titleFontSize}px`
  }
  return tokens
}
