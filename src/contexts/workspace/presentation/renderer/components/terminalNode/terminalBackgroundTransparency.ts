/**
 * Transparent terminals keep the plate-equivalent colour at zero alpha: xterm rejects the
 * `transparent` keyword, and TUI programs asking for the background (OSC 11) should hear the
 * colour the text actually sits on.
 */
export function toTransparentTerminalBackground(color: string): string {
  const channels = parseRgbChannels(color.trim())
  return channels ? `rgba(${channels.join(', ')}, 0)` : color
}

export function withTerminalBackgroundTransparency<T extends { background?: string }>(
  theme: T,
  allowTransparency: boolean,
): T {
  if (!allowTransparency || typeof theme.background !== 'string') {
    return theme
  }
  return { ...theme, background: toTransparentTerminalBackground(theme.background) }
}

function parseRgbChannels(value: string): [number, number, number] | null {
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1]
  if (hex) {
    const full = hex.length === 3 ? [...hex].map(digit => digit + digit).join('') : hex
    return [0, 2, 4].map(index => Number.parseInt(full.slice(index, index + 2), 16)) as [
      number,
      number,
      number,
    ]
  }
  const functional = value.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i)
  if (functional) {
    return [1, 2, 3].map(index => Math.round(Number(functional[index]))) as [number, number, number]
  }
  return null
}
