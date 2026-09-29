import { useState, useSyncExternalStore, type JSX } from 'react'
import { GitBranch, Puzzle } from 'lucide-react'
import { getBuiltinPluginManifest } from '../../application/builtinPlugins'
import type { PluginIconDeclaration } from '../../domain/pluginTypes'
import { getPluginAssets } from './pluginAssets'

interface PluginIconProps {
  pluginId: string
  className?: string
  size?: number
  strokeWidth?: number
}

const BUILTIN_ICONS = { 'git-branch': GitBranch, puzzle: Puzzle }

function subscribeTheme(notify: () => void): () => void {
  window.addEventListener('opencove-theme-changed', notify)
  return () => window.removeEventListener('opencove-theme-changed', notify)
}

function readTheme(): 'light' | 'dark' {
  return document.documentElement.dataset.coveTheme === 'light' ? 'light' : 'dark'
}

function FallbackIcon({ pluginId, className, size, strokeWidth }: PluginIconProps): JSX.Element {
  return (
    <Puzzle
      className={className}
      size={size}
      strokeWidth={strokeWidth}
      data-cove-plugin-icon={pluginId}
      data-plugin-icon-kind="fallback"
      aria-hidden="true"
      focusable="false"
    />
  )
}

function AssetIcon({
  declaration,
  ...props
}: PluginIconProps & { declaration: Extract<PluginIconDeclaration, { type: 'asset' }> }) {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => 'dark' as const)
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const assets = getPluginAssets(props.pluginId)
  const variant = declaration[theme] ?? declaration.path
  const path = Object.hasOwn(assets, variant) ? variant : declaration.path
  const source = Object.hasOwn(assets, path) ? assets[path] : null
  if (!source || source === failedSource) {
    return <FallbackIcon {...props} />
  }
  return (
    <img
      src={source}
      className={props.className}
      width={props.size}
      height={props.size}
      style={{ objectFit: 'contain' }}
      alt=""
      aria-hidden="true"
      draggable={false}
      data-cove-plugin-icon={props.pluginId}
      data-plugin-icon-kind="asset"
      onError={() => setFailedSource(source)}
    />
  )
}

/** One declarative identity for settings, creation actions and expanded/compact windows. */
export function PluginIcon({
  pluginId,
  className,
  size = 16,
  strokeWidth = 1.75,
}: PluginIconProps): JSX.Element {
  const declaration = getBuiltinPluginManifest(pluginId)?.icon
  const props = { pluginId, className, size, strokeWidth }
  if (declaration?.type === 'asset') {
    return <AssetIcon {...props} declaration={declaration} />
  }
  if (declaration?.type === 'builtin') {
    const Icon = Object.hasOwn(BUILTIN_ICONS, declaration.name)
      ? BUILTIN_ICONS[declaration.name]
      : null
    if (Icon) {
      return (
        <Icon
          className={className}
          size={size}
          strokeWidth={strokeWidth}
          data-cove-plugin-icon={pluginId}
          data-plugin-icon-kind="builtin"
          aria-hidden="true"
          focusable="false"
        />
      )
    }
  }
  return <FallbackIcon {...props} />
}
