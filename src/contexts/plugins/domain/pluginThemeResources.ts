/** Loaded from an immutable plugin snapshot, shared by the host and iframe SDK. */
export interface PluginThemeFont {
  family: string
  source: string
  descriptors?: {
    style?: string
    weight?: string
    stretch?: string
    display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional'
  }
}

export interface PluginThemeResources {
  themeStyles?: Record<string, string>
  themeFonts?: Record<string, PluginThemeFont[]>
}
