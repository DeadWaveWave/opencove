import type { InitialPromptFeedbackKind } from './initialPromptFeedback'

/** Admission stays in its existing policies; this is the canonical public rules list. */
export const INITIAL_PROMPT_RULES = [
  {
    kind: 'command_token',
    text: 'Launches: describe a task in a sentence; single ASCII words and provider command names are refused; unspaced Chinese/Japanese/Korean text is fine.',
  },
  {
    kind: 'provider_command_prefix',
    text: 'Provider controls: no leading /; Claude also refuses ! # &; Codex, OpenCode, Pi and Gemini also refuse !.',
  },
  { kind: 'provider_exit_word', text: 'Exit aliases: no exit, quit, :q, :q!, :wq or :wq!.' },
  {
    kind: 'unverified_file_reference',
    text: 'File references: no @ anywhere. Read approved content with opencove fs read --uri file:///workspace/README.md --fields content (replace the absolute URI), then paste the content.',
  },
  {
    kind: 'provider_skill_reference',
    text: 'Codex skills: no $name or linked skill mentions; paste the instructions.',
  },
  {
    kind: 'leading_dash',
    text: 'Leading dashes: Claude Code and Pi launches refuse prompts starting with -.',
  },
  { kind: 'nul', text: 'Null characters: remove NUL from the prompt.' },
] as const satisfies readonly { kind: InitialPromptFeedbackKind; text: string }[]

export const INITIAL_PROMPT_RULES_TEXT =
  'Agent-terminal prompt rules:\n' + INITIAL_PROMPT_RULES.map(rule => `- ${rule.text}`).join('\n')
