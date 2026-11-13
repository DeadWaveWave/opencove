import type { AppErrorDescriptor, AppErrorParams } from '../contracts/dto'

export const initialPromptPresentations = {
  command_token: {
    key: 'initialPromptCommandToken',
    message: 'The launch prompt {{token}} is a single token; a provider may read it as a command.',
    hint: 'Rephrase the task as a sentence describing your goal, for example “Explain how to use {{token}} in this project.” Your text has been kept.',
  },
  provider_command_prefix: {
    key: 'initialPromptCommandPrefix',
    message: 'This prompt starts with the provider control {{token}}.',
    hint: 'Ask about the control in a sentence, for example “Explain what {{token}} does.”',
  },
  provider_exit_word: {
    key: 'initialPromptExitWord',
    message: 'The prompt {{token}} is a provider exit alias.',
    hint: 'Describe your question about exiting, for example “Explain when to use {{token}}.”',
  },
  unverified_file_reference: {
    key: 'initialPromptFileReference',
    message:
      'This prompt contains the file reference {{token}}, whose access has not been verified.',
    hint: 'Read an approved file with opencove fs read --uri file:///workspace/README.md --fields content (replace the URI with the file’s absolute URI), then paste its content into the prompt, for example “Explain this file: …”.',
  },
  provider_skill_reference: {
    key: 'initialPromptSkillReference',
    message: 'This Codex prompt contains the skill mention {{token}}.',
    hint: 'Paste the instructions you want followed, for example “Review this project using these steps: …”.',
  },
  leading_dash: {
    key: 'initialPromptLeadingDash',
    message: 'The launch prompt starts with {{token}}, which this provider can read as an option.',
    hint: 'Ask about the option in a sentence, for example “Explain what {{token}} does.” Your text has been kept.',
  },
  nul: {
    key: 'initialPromptNul',
    message: 'This prompt contains the null character {{token}}.',
    hint: 'Remove the null character and keep the rest of your request, for example “Explain this project.” Your text has been kept.',
  },
} as const
export type InitialPromptFeedbackKind = keyof typeof initialPromptPresentations

function boundedToken(text: string): string {
  const points = Array.from(text.slice(0, 130))
  return points.length > 64 ? points.slice(0, 63).join('') + '…' : points.join('')
}

/** Quote a bounded fragment; never allow control or bidi characters to affect terminal output. */
export function quotePromptToken(text: string): string {
  return JSON.stringify(boundedToken(text)).replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, char => {
    const code = char.codePointAt(0)!
    return code <= 0xffff ? `\\u${code.toString(16).padStart(4, '0')}` : `\\u{${code.toString(16)}}`
  })
}

function render(kind: InitialPromptFeedbackKind, token: string) {
  const entry = initialPromptPresentations[kind]
  const quoted = quotePromptToken(token)
  return {
    key: entry.key,
    token: quoted,
    message: entry.message.replaceAll('{{token}}', () => quoted),
    hint: entry.hint.replaceAll('{{token}}', () => quoted),
  }
}

/** Display metadata only: callers retain their existing refusal code, reason and precedence. */
export function initialPromptFeedback(kind: InitialPromptFeedbackKind, text: string) {
  const fragment =
    kind === 'nul'
      ? '\0'
      : kind === 'unverified_file_reference'
        ? text.slice(text.indexOf('@'))
        : kind === 'provider_skill_reference'
          ? (text.match(/\$[A-Za-z0-9_:-]+/)?.[0] ?? '$name')
          : text.trim()
  const token = boundedToken(fragment.split(/[\s"'`()[\]<>]/u, 1)[0])
  const params: AppErrorParams = { promptKind: kind, promptToken: token }
  return { ...render(kind, token), params }
}

/** Rebuild known prose from validated display metadata, never from wire message/debugMessage. */
export function initialPromptErrorPresentation(error: {
  code?: string
  details?: unknown
  params?: AppErrorParams
}) {
  const kind = error.params?.promptKind
  const token = error.params?.promptToken
  if (
    typeof kind !== 'string' ||
    !Object.hasOwn(initialPromptPresentations, kind) ||
    typeof token !== 'string'
  ) {
    return undefined
  }
  const details = error.details as
    | { reason?: string; promptReason?: string; field?: string }
    | undefined
  const allowed =
    error.code === 'common.forbidden' && details?.reason === 'field_denied'
      ? details.promptReason === kind ||
        (kind === 'command_token' &&
          details.promptReason === undefined &&
          details.field === 'prompt')
      : error.code === 'common.invalid_input' &&
        (details?.reason === 'initial_prompt_contains_nul'
          ? kind === 'nul'
          : details?.reason === 'initial_prompt_unsupported' &&
            ['command_token', 'leading_dash', 'unverified_file_reference'].includes(kind))
  return allowed
    ? {
        ...render(kind as InitialPromptFeedbackKind, token),
        params: { promptKind: kind, promptToken: boundedToken(token) },
      }
    : undefined
}

export function initialPromptRefusalDescriptor(
  descriptor: AppErrorDescriptor,
  kind: InitialPromptFeedbackKind,
  text: string,
): AppErrorDescriptor & { debugMessage: string } {
  const feedback = initialPromptFeedback(kind, text)
  return {
    ...descriptor,
    params: feedback.params,
    debugMessage: `${feedback.message} ${feedback.hint}`,
  }
}
