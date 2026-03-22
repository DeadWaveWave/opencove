export const LABEL_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const

export type LabelColor = (typeof LABEL_COLORS)[number]

// `null` means “auto/inherit”. `'none'` means “explicitly unset”.
export type NodeLabelColorOverride = LabelColor | 'none' | null

export function isLabelColor(value: unknown): value is LabelColor {
  return LABEL_COLORS.includes(value as LabelColor)
}

export function normalizeLabelColor(value: unknown): LabelColor | null {
  return isLabelColor(value) ? value : null
}

export function normalizeNodeLabelColorOverride(value: unknown): NodeLabelColorOverride {
  if (value === null) {
    return null
  }

  if (value === 'none') {
    return 'none'
  }

  return normalizeLabelColor(value)
}
