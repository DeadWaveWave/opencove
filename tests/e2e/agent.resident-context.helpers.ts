import { expect, type Page } from '@playwright/test'
import type { MessagesRequest } from './agent.prompt.real-claude.helpers'
import type { ResponsesRequest } from './agent.prompt.real-codex.helpers'
import { residentContextV1 } from '../../src/shared/runtime/agentHook/residentContext'

export function claudeContext(body: MessagesRequest): string {
  const system =
    typeof body.system === 'string'
      ? body.system
      : (body.system ?? []).map(block => block.text ?? '').join('\n')
  return [
    system,
    ...(body.messages ?? []).map(message =>
      typeof message.content === 'string'
        ? message.content
        : message.content.map(block => block.text ?? '').join('\n'),
    ),
  ].join('\n')
}
export function codexContext(body: ResponsesRequest): string {
  return (body.input ?? [])
    .filter(item => item.role === 'developer')
    .flatMap(item => (item.content ?? []).map(block => block.text ?? ''))
    .join('\n')
}
export function expectResidentContext(text: string, enabled: boolean) {
  if (enabled) {
    expect(text).toContain(residentContextV1)
  } else {
    expect(text).not.toContain('You are running inside OpenCove')
  }
}

export async function clearConversation(page: Page, sessionId: string) {
  // Slash commands need an Enter outside the provider's paste burst.
  await page.evaluate(async payload => await window.opencoveApi.pty.write(payload), {
    sessionId,
    data: '/clear',
  })
  await page.waitForTimeout(500)
  await page.evaluate(async payload => await window.opencoveApi.pty.write(payload), {
    sessionId,
    data: '\r',
  })
  // Clear has no model turn. Allow its startup hooks to drain before the next CLI prompt.
  await page.waitForTimeout(1500)
}
