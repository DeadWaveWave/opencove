import { afterEach, expect, it } from 'vitest'
import { assertProviderInitialPrompt } from '../../../src/contexts/agent/domain/providerInitialPromptPolicy'
import { assertSessionGrantMessagePrompt } from '../../../src/app/main/controlSurface/http/sessionGrantPromptPolicy'
import { checkSessionGrantLaunch } from '../../../src/app/main/controlSurface/http/sessionGrantLaunchPolicy'
import {
  initialPromptErrorPresentation,
  quotePromptToken,
} from '../../../src/shared/errors/initialPromptFeedback'
import { toAppErrorDescriptor, formatAppErrorMessage } from '../../../src/shared/errors/appError'
import { publicTerminalSpawnApplicationError } from '../../../src/shared/errors/terminalSpawnErrorReasons'
import { toErrorMessage } from '../../../src/app/renderer/shell/utils/format'
import { applyUiLanguage } from '../../../src/app/renderer/i18n'
import { authorizationError } from '../../../src/app/cli/core/authorizationError'
import { invoke } from '../../../src/app/cli/core/transport'
import { publicTerminalSpawnError } from '../../../src/shared/errors/terminalSpawnError'

const launch = (prompt: string) =>
  checkSessionGrantLaunch({ prompt }, {
    operationId: 'session.launchAgent',
    wirePayload: { prompt },
  } as Parameters<typeof checkSessionGrantLaunch>[1])
const grant = (text: string, provider = 'codex' as const) =>
  assertSessionGrantMessagePrompt(text, { provider, operationId: 'agent.prompt', field: 'text' })
function refused(action: () => void) {
  try {
    action()
  } catch (error) {
    return toAppErrorDescriptor(error)
  }
  throw new Error('Expected a refusal')
}
const cases = [
  ['single token', () => launch('update'), 'common.forbidden', undefined],
  [
    'command collision',
    () => assertProviderInitialPrompt('pi', 'config'),
    'common.invalid_input',
    undefined,
  ],
  ['provider prefix', () => grant('  /help'), 'common.forbidden', 'provider_command_prefix'],
  ['exit alias', () => grant(':q!'), 'common.forbidden', 'provider_exit_word'],
  [
    'file reference',
    () => grant('Explain "@README.md" please'),
    'common.forbidden',
    'unverified_file_reference',
  ],
  [
    'Codex skill',
    () => grant('Use [$review](path) please'),
    'common.forbidden',
    'provider_skill_reference',
  ],
  [
    'leading dash',
    () => assertProviderInitialPrompt('claude-code', '--help'),
    'common.invalid_input',
    undefined,
  ],
  ['NUL', () => launch('plugins\0 explain'), 'common.invalid_input', undefined],
] as const
afterEach(async () => applyUiLanguage('en'))

it.each(cases)(
  '%s keeps codes/reasons and shows focused bilingual recovery',
  async (_name, action, code, promptReason) => {
    const error = refused(action)
    expect(error.code).toBe(code)
    expect((error.details as { promptReason?: string }).promptReason).toBe(promptReason)
    const presentation = initialPromptErrorPresentation(error)!
    expect(presentation).toBeDefined()
    const example = presentation.hint.match(/“([^”]+)”/)![1]
    expect(() => launch(example)).not.toThrow()
    expect(() => grant(example)).not.toThrow()
    expect(() => assertProviderInitialPrompt('pi', example)).not.toThrow()
    expect(formatAppErrorMessage(error)).toBe(`${presentation.message} ${presentation.hint}`)
    await applyUiLanguage('en')
    const en = toErrorMessage(error)
    await applyUiLanguage('zh-CN')
    const zhCN = toErrorMessage(error)
    expect({ message: presentation.message, hint: presentation.hint, en, zhCN }).toMatchSnapshot()
    if (code === 'common.forbidden') {
      expect(authorizationError(403, error)).toMatchObject({
        code,
        exitCode: 4,
        message: presentation.message,
        hint: presentation.hint,
        details: error.details,
      })
    } else {
      expect(publicTerminalSpawnApplicationError({ ...error, debugMessage: 'untrusted' })).toEqual(
        error,
      )
    }
  },
)

it('quotes only a bounded triggering token and escapes control/bidi characters', () => {
  const error = refused(() => grant('/' + '界'.repeat(1000) + '\u001b\u202e private context'))
  const presentation = initialPromptErrorPresentation(error)!
  expect(presentation.message.length).toBeLessThan(180)
  expect(presentation.message).toContain('…')
  expect(JSON.stringify(error)).not.toContain('private context')
  const control = initialPromptErrorPresentation(refused(() => grant('/a\u001b\u202e')))!
  expect(control.message).not.toMatch(/[\p{Cc}\p{Cf}]/u)
  expect(control.message).toContain('\\u001b')
  expect(control.message).toContain('\\u202e')
})

it('does not interpret unrelated error prose or unknown display categories', () => {
  expect(
    initialPromptErrorPresentation({
      code: 'common.forbidden',
      details: { reason: 'field_denied', message: '/help' },
    }),
  ).toBeUndefined()
  expect(
    initialPromptErrorPresentation({
      code: 'common.forbidden',
      params: { promptKind: '__proto__', promptToken: 'update' },
    }),
  ).toBeUndefined()
})

it('interpolates quotes, backslashes, unicode and replacement markers literally', () => {
  expect(quotePromptToken('say "hello"\\中文')).toBe(JSON.stringify('say "hello"\\中文'))
  const error = refused(() => grant('/$&\\中文'))
  const presentation = initialPromptErrorPresentation(error)!
  expect(presentation.message).toBe('This prompt starts with the provider control "/$&\\\\中文".')
  expect(presentation.hint).toContain('Explain what "/$&\\\\中文" does.')
})

it('retains bounded display metadata across the public spawn boundary without private fields', () => {
  const error = refused(() => assertProviderInitialPrompt('pi', '-' + '😀'.repeat(100)))
  const wire = JSON.parse(
    JSON.stringify({
      ...error,
      debugMessage: 'private diagnostic',
      params: { ...error.params, secret: 'private environment' },
      details: { ...(error.details as object), env: 'private environment' },
    }),
  )
  const output = publicTerminalSpawnError(wire, 'agent.launch_failed').toDescriptor()
  expect(output).toEqual(error)
  expect(Array.from(String(output.params?.promptToken))).toHaveLength(64)
  expect(JSON.stringify(output)).not.toContain('private')
})

it.each([
  ['/help @file $name', 'provider_command_prefix'],
  ['Explain @file and $name', 'unverified_file_reference'],
  ['exit $name', 'provider_skill_reference'],
])('keeps the original refusal priority for %j', (text, promptReason) => {
  expect(refused(() => grant(text))).toMatchObject({ details: { promptReason } })
})

it('keeps the focused NUL message and hint through the CLI transport', async () => {
  const error = refused(() => launch('plugins\0 explain'))
  const presentation = initialPromptErrorPresentation(error)!
  await expect(
    invoke(
      { endpoint: 'http://localhost', token: 'test' } as Parameters<typeof invoke>[0],
      { kind: 'command', id: 'session.launchAgent', payload: {} },
      { timeoutMs: 1000, fetch: async () => new Response(JSON.stringify({ ok: false, error })) },
    ),
  ).rejects.toMatchObject({
    code: error.code,
    exitCode: 2,
    message: presentation.message,
    hint: presentation.hint,
  })
})
