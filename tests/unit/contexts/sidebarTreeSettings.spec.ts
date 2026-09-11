import { describe, expect, it } from 'vitest'
import { normalizeAgentSettings } from '../../../src/contexts/settings/domain/agentSettings'

describe('sidebar tree settings recovery', () => {
  it('preserves collapsed project and scoped Space identities across normalization', () => {
    const settings = normalizeAgentSettings({
      sidebarCollapsedWorkspaceIds: { 'project-a': true, 'project-b': false },
      sidebarCollapsedSpaceGroupIds: { 'project-a:space-a': true },
    })
    expect(settings).toMatchObject({
      sidebarCollapsedWorkspaceIds: { 'project-a': true },
      sidebarCollapsedSpaceGroupIds: { 'project-a:space-a': true },
    })
    expect(normalizeAgentSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings)
  })

  it.each([
    undefined,
    null,
    {},
    { sidebarCollapsedWorkspaceIds: [], sidebarCollapsedSpaceGroupIds: 1 },
  ])('restores legacy or malformed settings with expanded trees: %j', input => {
    expect(normalizeAgentSettings(input)).toMatchObject({
      sidebarCollapsedWorkspaceIds: {},
      sidebarCollapsedSpaceGroupIds: {},
    })
  })

  it('rejects truthy non-boolean entries and preserves exact stable IDs', () => {
    expect(
      normalizeAgentSettings({
        sidebarCollapsedWorkspaceIds: { keep: true, no: false, invalid: 'true', '': true },
        sidebarCollapsedSpaceGroupIds: { 'project-a:root': true, 'project-b:root': false },
      }),
    ).toMatchObject({
      sidebarCollapsedWorkspaceIds: { keep: true },
      sidebarCollapsedSpaceGroupIds: { 'project-a:root': true },
    })
  })
})
