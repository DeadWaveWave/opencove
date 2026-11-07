import { invalidPromptField } from '../../../shared/errors/promptValidation'

/** Validate before normalization so forbidden bytes cannot disappear at the boundary. */
export function canonicalizePromptText(text: string): string {
  if (!text.isWellFormed()) {
    invalidPromptField(
      'text',
      'Prompt text must be valid Unicode. Nothing was sent.',
      'Check the input encoding and supply valid UTF-8 text.',
    )
  }
  // Protocol validation deliberately rejects embedded terminal control characters.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(text)) {
    invalidPromptField(
      'text',
      'Prompt text contains an unsupported control character. Nothing was sent.',
      'Remove terminal escape sequences and control characters other than tabs and newlines.',
    )
  }
  const bytes = new TextEncoder().encode(text).length
  if (bytes > 32 * 1024) {
    invalidPromptField(
      'text',
      'Prompt text exceeds 32 KiB in UTF-8. Nothing was sent.',
      'Shorten the prompt. The limit applies before newline normalization.',
    )
  }
  const canonical = text.replace(/\r\n|\r|\n/g, '\r').replace(/\r+$/, '')
  if (!canonical.trim()) {
    invalidPromptField(
      'text',
      'Prompt text must contain at least one non-whitespace character. Nothing was sent.',
      'Supply text with --text or a nonempty UTF-8 file with --text-file.',
    )
  }
  return canonical
}
