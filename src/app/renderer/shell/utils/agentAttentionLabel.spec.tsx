import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { applyUiLanguage, translate } from '@app/renderer/i18n'
import { agentAttentionLabelKey } from '@contexts/workspace/presentation/renderer/utils/agentAttentionLabel'
import { AgentActivityList } from '../components/AgentActivityList'
import type { AgentActivityReference } from './agentActivitySummary'

afterEach(async () => {
  cleanup()
  await applyUiLanguage('en')
})
it.each([
  [null, 'Needs your answer', '需要你回复'],
  ['permission', 'Needs approval', '需要批准'],
  ['question', 'Has a question', '有问题想问你'],
  ['plan', 'Plan ready for review', '计划待审阅'],
] as const)('labels blocked %s consistently in both languages', async (blockedReason, en, zh) => {
  const key = agentAttentionLabelKey({ blockedReason })
  await applyUiLanguage('en')
  expect(translate(key)).toBe(en)
  await applyUiLanguage('zh-CN')
  expect(translate(key)).toBe(zh)
})
it('distinguishes finished attention from blocked attention in visible and accessible rows', async () => {
  await applyUiLanguage('en')
  expect(translate(agentAttentionLabelKey({ needsYouSinceMs: 1 }))).toBe('Finished')
  const base: AgentActivityReference = {
    workspaceId: 'w',
    nodeId: 'a',
    projectName: 'Project',
    projectIconId: null,
    title: 'Agent',
    spaceName: null,
    provider: 'codex',
  }
  render(
    <AgentActivityList
      summary={{
        waiting: [
          { ...base, needsYouSinceMs: 1 },
          { ...base, nodeId: 'b', blockedReason: 'question' },
        ],
        working: [],
      }}
      onSelect={() => {}}
    />,
  )
  expect(screen.getByText('Finished')).toBeTruthy()
  expect(screen.getByText('Has a question')).toBeTruthy()
  expect(screen.getByRole('button', { name: /Finished/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Has a question/ })).toBeTruthy()
  await applyUiLanguage('zh-CN')
  expect(translate(agentAttentionLabelKey({ needsYouSinceMs: 1 }))).toBe('已完成')
})
