import type { PluginThemeTypography, PluginThemeMetrics } from './pluginThemeMetrics'
import type { PluginThemeMotion } from './pluginThemeMotion'

/** Public color and material tokens. Bundled stylesheets provide component skins. */
export const PLUGIN_THEME_TOKENS = [
  '--cove-app-background',
  '--cove-app-background-elevated',
  '--cove-surface',
  '--cove-surface-strong',
  '--cove-window-surface',
  '--cove-surface-hover',
  '--cove-field',
  '--cove-border',
  '--cove-border-subtle',
  '--cove-text',
  '--cove-text-muted',
  '--cove-text-faint',
  '--cove-accent',
  '--cove-accent-text',
  '--cove-accent-foreground',
  '--cove-focus-ring',
  '--cove-node-surface',
  '--cove-node-header-surface',
  '--cove-node-border',
  '--cove-terminal-background',
  '--cove-terminal-foreground',
  '--cove-terminal-cursor',
  '--cove-terminal-selection',
  '--cove-canvas-dot',
  '--cove-terminal-ansi-black',
  '--cove-terminal-ansi-red',
  '--cove-terminal-ansi-green',
  '--cove-terminal-ansi-yellow',
  '--cove-terminal-ansi-blue',
  '--cove-terminal-ansi-magenta',
  '--cove-terminal-ansi-cyan',
  '--cove-terminal-ansi-white',
  '--cove-terminal-ansi-bright-black',
  '--cove-terminal-ansi-bright-red',
  '--cove-terminal-ansi-bright-green',
  '--cove-terminal-ansi-bright-yellow',
  '--cove-terminal-ansi-bright-blue',
  '--cove-terminal-ansi-bright-magenta',
  '--cove-terminal-ansi-bright-cyan',
  '--cove-terminal-ansi-bright-white',
  '--cove-pixel-blue',
  '--cove-pixel-cyan',
  '--cove-pixel-mint',
  '--cove-node-background-image',
  '--cove-node-shadow',
  '--cove-node-shadow-hover',
  '--cove-node-shadow-focus',
  '--cove-node-header-border',
  '--cove-pixel-header-filter',
  '--cove-space-surface',
  '--cove-space-border',
  '--cove-space-shadow',
  '--cove-space-caption-surface',
] as const
export type PluginThemeToken = (typeof PLUGIN_THEME_TOKENS)[number]
export const PLUGIN_THEME_BASES = [
  'light',
  'dark',
  'pixel',
  'pixel-light',
  'ember',
  'ember-light',
] as const
export type PluginThemeBase = (typeof PLUGIN_THEME_BASES)[number]

export interface PluginThemeDeclaration {
  id: string
  title: string
  appearance: 'light' | 'dark'
  /** A shipped visual foundation; actual selected identity remains the plugin's identity. */
  extends?: PluginThemeBase
  tokens: Partial<Record<PluginThemeToken, string>>
  /** Package-relative CSS, compiled from the installed immutable revision. */
  stylesheet?: string
  typography?: PluginThemeTypography
  metrics?: PluginThemeMetrics
  motion?: PluginThemeMotion
}
