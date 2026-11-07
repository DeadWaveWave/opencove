export type ResolvedUiTheme = 'light' | 'dark'

export interface SetWindowChromeThemeInput {
  theme: ResolvedUiTheme
}

/** Whether a window is in native full screen, where macOS hides its traffic lights. */
export interface WindowFullScreenState {
  isFullScreen: boolean
}
