import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_AGENT_SETTINGS,
  isNormalizedAgentSettings,
  normalizeAgentSettings,
  type AgentSettings,
} from '../../../src/contexts/settings/domain/agentSettings'
import { createSettingsPanelUpdaters } from '../../../src/contexts/settings/presentation/renderer/useSettingsPanelUpdaters'
import {
  readPersistedState,
  toPersistedState,
  writeRawPersistedState,
} from '../../../src/contexts/workspace/presentation/renderer/utils/persistence'
import { installMockStorage } from '../../support/persistenceTestStorage'

installMockStorage()
beforeEach(() => window.localStorage.clear())

const effects = (settings: AgentSettings) => ({
  canvasPixelBackgroundEnabled: settings.canvasPixelBackgroundEnabled,
  nodeCreationPixelEffectEnabled: settings.nodeCreationPixelEffectEnabled,
  nodeClosePixelEffectEnabled: settings.nodeClosePixelEffectEnabled,
})
const disabled = {
  canvasPixelBackgroundEnabled: false,
  nodeCreationPixelEffectEnabled: false,
  nodeClosePixelEffectEnabled: false,
}

describe('independent persisted Pixel effect settings', () => {
  it.each([
    undefined,
    null,
    {},
    { uiTheme: 'dark' },
    { uiTheme: 'light' },
    { uiTheme: 'ember' },
    { uiTheme: 'ember-light' },
    { uiTheme: 'system' },
    { uiTheme: 'invalid' },
  ])('keeps effects opt-in for legacy non-Pixel settings: %j', raw => {
    expect(effects(normalizeAgentSettings(raw))).toEqual(disabled)
    expect(effects(DEFAULT_AGENT_SETTINGS)).toEqual(disabled)
  })

  it('migrates legacy Pixel settings once and emits the complete canonical shape', () => {
    const migrated = normalizeAgentSettings({ uiTheme: 'pixel' })
    expect(effects(migrated)).toEqual({
      canvasPixelBackgroundEnabled: true,
      nodeCreationPixelEffectEnabled: true,
      nodeClosePixelEffectEnabled: true,
    })
    expect(isNormalizedAgentSettings(migrated)).toBe(true)
    expect(effects(normalizeAgentSettings({ ...migrated, uiTheme: 'light' }))).toEqual(
      effects(migrated),
    )
    const legacy = { ...migrated } as Record<string, unknown>
    delete legacy.nodeClosePixelEffectEnabled
    expect(isNormalizedAgentSettings(legacy)).toBe(false)
  })

  it('preserves each explicit boolean and normalizes only missing or invalid flags', () => {
    expect(
      effects(
        normalizeAgentSettings({
          uiTheme: 'pixel',
          canvasPixelBackgroundEnabled: false,
          nodeCreationPixelEffectEnabled: true,
          nodeClosePixelEffectEnabled: 'false',
        }),
      ),
    ).toEqual({
      canvasPixelBackgroundEnabled: false,
      nodeCreationPixelEffectEnabled: true,
      nodeClosePixelEffectEnabled: true,
    })
    expect(
      effects(
        normalizeAgentSettings({
          uiTheme: 'system',
          canvasPixelBackgroundEnabled: true,
          nodeCreationPixelEffectEnabled: null,
          nodeClosePixelEffectEnabled: false,
        }),
      ),
    ).toEqual({ ...disabled, canvasPixelBackgroundEnabled: true })
  })

  it('preserves mixed choices through the settings updater, theme changes and persistence reload', async () => {
    let settings = normalizeAgentSettings({ uiTheme: 'pixel' })
    const updaters = () =>
      createSettingsPanelUpdaters({
        settings,
        onChange: next => {
          settings = normalizeAgentSettings(next)
        },
      })
    updaters().updatePixelEffect('canvasPixelBackgroundEnabled', false)
    updaters().updatePixelEffect('nodeClosePixelEffectEnabled', false)
    updaters().updateUiTheme('light')
    const expected = { ...disabled, nodeCreationPixelEffectEnabled: true }
    expect(effects(settings)).toEqual(expected)
    expect(settings.uiTheme).toBe('light')
    await writeRawPersistedState(JSON.stringify(toPersistedState([], null, settings)))
    const reloaded = await readPersistedState()
    expect(reloaded).not.toBeNull()
    settings = reloaded!.settings
    expect(effects(settings)).toEqual(expected)
    updaters().updateUiTheme('pixel')
    expect(effects(settings)).toEqual(expected)
  })

  it('migrates raw legacy settings through the persistence reader before later updates', async () => {
    await writeRawPersistedState(
      JSON.stringify({
        formatVersion: 1,
        activeWorkspaceId: null,
        workspaces: [],
        settings: { uiTheme: 'pixel' },
      }),
    )
    const migrated = await readPersistedState()
    expect(migrated?.settings).toMatchObject({
      canvasPixelBackgroundEnabled: true,
      nodeCreationPixelEffectEnabled: true,
      nodeClosePixelEffectEnabled: true,
    })
    const changed = normalizeAgentSettings({ ...migrated!.settings, ...disabled, uiTheme: 'light' })
    await writeRawPersistedState(JSON.stringify(toPersistedState([], null, changed)))
    expect(effects((await readPersistedState())!.settings)).toEqual(disabled)
  })

  it('does not reapply Pixel legacy defaults when a normalized dark user changes theme', () => {
    let settings = normalizeAgentSettings({ uiTheme: 'dark' })
    createSettingsPanelUpdaters({
      settings,
      onChange: next => {
        settings = next
      },
    }).updateUiTheme('pixel')
    expect(effects(normalizeAgentSettings(settings))).toEqual(disabled)
  })
})
