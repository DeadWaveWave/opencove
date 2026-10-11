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
  agentWorkingPixelEffectEnabled: settings.agentWorkingPixelEffectEnabled,
})
const disabled = {
  canvasPixelBackgroundEnabled: false,
  nodeCreationPixelEffectEnabled: false,
  nodeClosePixelEffectEnabled: false,
  agentWorkingPixelEffectEnabled: false,
}

describe('independent persisted Pixel effect settings', () => {
  it('restores missing plugin theme effect fields with current defaults while preserving explicit opt-outs', async () => {
    await writeRawPersistedState(
      JSON.stringify({
        formatVersion: 1,
        activeWorkspaceId: null,
        workspaces: [],
        settings: {
          uiTheme: 'plugin:studio:night',
          nodeClosePixelEffectEnabled: false,
          canvasPixelBackgroundEnabled: false,
        },
      }),
    )
    const restored = await readPersistedState()
    expect(restored?.settings).toMatchObject({
      uiTheme: 'plugin:studio:night',
      canvasPixelBackgroundEnabled: false,
      nodeClosePixelEffectEnabled: false,
      nodeCreationPixelEffectEnabled: true,
      agentWorkingPixelEffectEnabled: true,
    })
    expect(effects(normalizeAgentSettings({ uiTheme: 'plugin:missing:night' }))).toEqual(
      effects(DEFAULT_AGENT_SETTINGS),
    )
    expect(effects(normalizeAgentSettings({ ...restored!.settings, uiTheme: 'light' }))).toEqual(
      effects(restored!.settings),
    )
  })

  it.each([
    { uiTheme: 'dark' },
    { uiTheme: 'light' },
    { uiTheme: 'ember' },
    { uiTheme: 'ember-light' },
    { uiTheme: 'system' },
  ])('keeps effects opt-in for legacy non-Pixel settings: %j', raw => {
    expect(effects(normalizeAgentSettings(raw))).toEqual(disabled)
  })

  it.each([undefined, null, {}, { uiTheme: 'invalid' }])(
    'starts unconfigured users in Pixel with all effects: %j',
    raw => {
      expect(normalizeAgentSettings(raw).uiTheme).toBe('pixel')
      expect(Object.values(effects(normalizeAgentSettings(raw)))).toEqual([true, true, true, true])
      expect(effects(normalizeAgentSettings(raw))).toEqual(effects(DEFAULT_AGENT_SETTINGS))
    },
  )

  it.each(['pixel', 'pixel-light'])(
    'migrates legacy %s settings once and emits the complete canonical shape',
    uiTheme => {
      const migrated = normalizeAgentSettings({ uiTheme })
      expect(effects(migrated)).toEqual({
        canvasPixelBackgroundEnabled: true,
        nodeCreationPixelEffectEnabled: true,
        nodeClosePixelEffectEnabled: true,
        agentWorkingPixelEffectEnabled: true,
      })
      expect(isNormalizedAgentSettings(migrated)).toBe(true)
      expect(effects(normalizeAgentSettings({ ...migrated, uiTheme: 'light' }))).toEqual(
        effects(migrated),
      )
      const legacy = { ...migrated } as Record<string, unknown>
      delete legacy.agentWorkingPixelEffectEnabled
      expect(isNormalizedAgentSettings(legacy)).toBe(false)
    },
  )

  it.each(['pixel', 'pixel-light'])(
    'preserves each explicit %s boolean and normalizes only missing or invalid flags',
    uiTheme => {
      expect(
        effects(
          normalizeAgentSettings({
            uiTheme,
            canvasPixelBackgroundEnabled: false,
            nodeCreationPixelEffectEnabled: true,
            nodeClosePixelEffectEnabled: 'false',
            agentWorkingPixelEffectEnabled: false,
          }),
        ),
      ).toEqual({
        canvasPixelBackgroundEnabled: false,
        nodeCreationPixelEffectEnabled: true,
        nodeClosePixelEffectEnabled: true,
        agentWorkingPixelEffectEnabled: false,
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
    },
  )

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
    updaters().updatePixelEffect('agentWorkingPixelEffectEnabled', false)
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
    updaters().updateUiTheme('pixel-light')
    expect(effects(settings)).toEqual(expected)
    expect(settings.uiTheme).toBe('pixel-light')
  })

  it.each(['pixel', 'pixel-light'])(
    'migrates raw legacy %s settings through the persistence reader before later updates',
    async uiTheme => {
      await writeRawPersistedState(
        JSON.stringify({
          formatVersion: 1,
          activeWorkspaceId: null,
          workspaces: [],
          settings: { uiTheme },
        }),
      )
      const migrated = await readPersistedState()
      expect(migrated?.settings).toMatchObject({
        canvasPixelBackgroundEnabled: true,
        nodeCreationPixelEffectEnabled: true,
        nodeClosePixelEffectEnabled: true,
      })
      const changed = normalizeAgentSettings({
        ...migrated!.settings,
        ...disabled,
        uiTheme: 'light',
      })
      await writeRawPersistedState(JSON.stringify(toPersistedState([], null, changed)))
      expect(effects((await readPersistedState())!.settings)).toEqual(disabled)
    },
  )

  it.each(['pixel', 'pixel-light'] as const)(
    'does not reapply %s legacy defaults when a normalized dark user changes theme',
    uiTheme => {
      let settings = normalizeAgentSettings({ uiTheme: 'dark' })
      createSettingsPanelUpdaters({
        settings,
        onChange: next => {
          settings = next
        },
      }).updateUiTheme(uiTheme)
      expect(effects(normalizeAgentSettings(settings))).toEqual(disabled)
    },
  )
})
