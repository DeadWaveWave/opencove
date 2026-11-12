const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
export function graphemes(text: string) {
  return segmenter.segment(text)
}

/** Fixed terminal cells: wide/fullwidth CJK and emoji are two; combining marks add none. */
export function cellWidth(text: string): number {
  if (/^[\p{Mark}\p{Default_Ignorable_Code_Point}]+$/u.test(text)) {
    return 0
  }
  const code = text.codePointAt(0)!
  if (
    code >= 0x1100 &&
    (code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff01 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1b000 && code <= 0x1b2ff) ||
      (code >= 0x1f200 && code <= 0x1f251) ||
      (code >= 0x20000 && code <= 0x3fffd))
  ) {
    return 2
  }
  if (
    !text.includes('\ufe0e') &&
    (/\p{Emoji_Presentation}/u.test(text) ||
      (text.includes('\ufe0f') && /\p{Extended_Pictographic}/u.test(text)) ||
      text.includes('\u20e3'))
  ) {
    return 2
  }
  return 1
}
