import { createHash } from 'node:crypto'

export interface PromptSubmissionEvidence {
  claudeAuxiliary?: true
  invocationId?: string
  conversationCapture?: object
  conversationGeneration?: number
  promptId?: string
  promptDigest?: string
  providerSessionId?: string
  providerTurnId?: string
  finalMessage?: { message: string; truncated: boolean }
}

// Private, same-process ingress metadata: never serialized, spread, or added to public DTOs.
const evidenceByEvent = new WeakMap<object, PromptSubmissionEvidence>()
export function setPromptSubmissionEvidence(
  event: object,
  evidence: PromptSubmissionEvidence,
): void {
  evidenceByEvent.set(event, {
    claudeAuxiliary: evidence.claudeAuxiliary,
    invocationId: evidence.invocationId,
    conversationGeneration: evidence.conversationGeneration,
    conversationCapture: evidence.conversationCapture,
    promptId: evidence.promptId,
    promptDigest: evidence.promptDigest,
    providerSessionId: evidence.providerSessionId,
    providerTurnId: evidence.providerTurnId,
    finalMessage: evidence.finalMessage,
  })
}
export function getPromptSubmissionEvidence(event: object): PromptSubmissionEvidence | undefined {
  return evidenceByEvent.get(event)
}

// Linear on purpose: a suffix regex such as /[ \t\n]+$/ is quadratic on a long whitespace run
// followed by text, and this runs on the hook receiver's event loop.
function trimTrailingAsciiWhitespace(value: string): string {
  let end = value.length
  while (end > 0) {
    const code = value.charCodeAt(end - 1)
    if (code !== 0x20 && code !== 0x09 && code !== 0x0a) {
      break
    }
    end -= 1
  }
  return value.slice(0, end)
}

/** Bounded by the existing 256 KiB hook envelope; hash full well-formed strings only. */
export function claudePromptDigest(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length > 256 * 1024 ||
    !value.isWellFormed() ||
    Buffer.byteLength(value, 'utf8') > 256 * 1024
  ) {
    return undefined
  }
  const normalized = trimTrailingAsciiWhitespace(value.replace(/\r\n|\r/g, '\n'))
  return createHash('sha256')
    .update('opencove-prompt-evidence-claude-code-v1\0', 'utf8')
    .update(normalized, 'utf8')
    .digest('hex')
}

/** Diagnostic provider identifier: keep it verbatim, never accept controls or unbounded data. */
export function claudePromptId(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    value.isWellFormed() &&
    !/[\s\p{Cc}]/u.test(value)
    ? value
    : undefined
}
