import { act, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  PREFERENCE_KEYS,
  commandsOf,
  controls,
  installCanvasHarnessHooks,
  latest,
  mount,
  observe,
  A,
  B,
  noteNode,
  reactFlow,
} from '../../support/canvasNodeCommandsHarness'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { setDocumentNodes } from '../../support/documentNodes'
import { terminalCalibration } from '../../support/terminalCalibration'

// S7 of #647, Decision 3 and its amendment (Decision 14): node components read the canvas's
// commands from context, and the whole params value they read keeps its identity until the
// workspace or its configuration changes. This spec mounts the real canvas on a faithful React
// Flow mock and records every value a consumer of the context sees, on every render of the host.
//
// Why the commands have a context of their own: a context consumer renders on every change of the
// context value, whatever field it reads. A memoised window body that reads only commands (the
// terminal, document, folder, image and plugin bodies) must therefore not subscribe to the params,
// which also hold the preferences and change with them. `useCanvasNodeCommands()` reads the
// commands context that `WorkspaceCanvasNodeTypesProvider` provides next to the params;
// `canvasNodeCommands.mountedRenders.spec.tsx` pins that those bodies do not render for a
// preference.
//
// The harness is `tests/support/canvasNodeCommandsHarness.tsx`; the window rows, the closed-node
// table and the composition rows are in `canvasNodeCommands.window.spec.tsx`, `.closedNode.spec.tsx`
// and `.composition.spec.tsx`.

installCanvasHarnessHooks()

describe('the identity of the node commands and of the params value (Decision 3, amended by 14)', () => {
  const settingsWith = (patch: Partial<typeof DEFAULT_AGENT_SETTINGS>) =>
    act(() => {
      useAppStore.setState(state => ({ agentSettings: { ...state.agentSettings, ...patch } }))
    })

  // One row per cause. Each must render the canvas (the probe sees at least one render), and the
  // value the context holds on every one of those renders is the first one.
  const unchangedRows: Array<[string, () => void | Promise<void>]> = [
    [
      'a document write',
      () => {
        setDocumentNodes(A, [noteNode('a', 'a-text', 40), noteNode('b', 'b-text', 600)])
      },
    ],
    ['a select batch', () => void fireEvent.click(screen.getByTestId('select-a'))],
    [
      // `useReactFlow()` returns a new object, and `focusForInteraction` must not depend on it:
      // its helpers keep their identity (see the mock).
      'React Flow initializing its viewport (a new instance, the same viewport helpers)',
      () => reactFlow.setState({ viewportInitialized: true }),
    ],
    [
      'a deserialized copy of the settings with equal preferences (a Worker sync of a zoom change)',
      () => {
        useAppStore.setState(state => ({
          agentSettings: JSON.parse(
            JSON.stringify({ ...state.agentSettings, focusNodeTargetZoom: 0.77 }),
          ),
        }))
      },
    ],
    ['a drag frame', () => void fireEvent.click(screen.getByTestId('drag-frame'))],
    [
      'a render with equal props (a new, equal settings object)',
      () => {
        useAppStore.setState(state => ({ agentSettings: { ...state.agentSettings } }))
      },
    ],
    [
      'a settings change that touches none of the six preferences (focusNodeTargetZoom)',
      () => {
        useAppStore.setState(state => ({
          agentSettings: { ...state.agentSettings, focusNodeTargetZoom: 0.6 },
        }))
      },
    ],
    [
      // The terminal commands read the launch fields when a launch starts (PR 5): a guard, green on
      // the base, where the refs hide the identity.
      'a settings change of a launch field the terminal commands read at call time (agentFullAccess)',
      () => {
        useAppStore.setState(state => ({
          agentSettings: {
            ...state.agentSettings,
            agentFullAccess: !state.agentSettings.agentFullAccess,
          },
        }))
      },
    ],
    [
      // The role run reads the definitions of the project when it starts (PR 6).
      'a settings change of the role definitions the role commands read at call time',
      () => {
        useAppStore.setState(state => ({
          agentSettings: {
            ...state.agentSettings,
            projectRolesByWorkspaceId: {
              [A]: [
                {
                  id: 'role-1',
                  name: 'Reviewer',
                  description: '',
                  promptTemplate: 'Review: {{input}}',
                  inputHint: '',
                  outputFormat: '',
                  createdAt: '2026-03-15T00:00:00.000Z',
                  updatedAt: '2026-03-15T00:00:00.000Z',
                },
              ],
            },
          },
        }))
      },
    ],
    [
      'a settings change of a field the commands read at call time (standardWindowSizeBucket)',
      () => {
        useAppStore.setState(state => ({
          agentSettings: { ...state.agentSettings, standardWindowSizeBucket: 'large' },
        }))
      },
    ],
  ]

  it.each(unchangedRows)(
    'keeps the params value and the commands across %s',
    async (_name, act1) => {
      await mount()
      const before = latest()

      const renders = await observe(act1)

      expect(renders.length).toBeGreaterThan(0)
      for (const snapshot of renders) {
        expect(snapshot.params).toBe(before.params)
        expect(snapshot.params.commands).toBe(before.params.commands)
        for (const key of PREFERENCE_KEYS) {
          expect(snapshot.params[key], key).toBe(before.params[key])
        }
      }
    },
  )

  it('keeps the family objects across the same rows, so a family consumer is not renewed either', async () => {
    await mount()
    const before = commandsOf()

    await observe(() => {
      useAppStore.setState(state => ({
        agentSettings: { ...state.agentSettings, focusNodeTargetZoom: 0.55 },
      }))
    })
    await observe(() => void fireEvent.click(screen.getByTestId('select-a')))

    expect(commandsOf().window).toBe(before.window)
    expect(commandsOf().terminal).toBe(before.terminal)
    expect(commandsOf().note).toBe(before.note)
    expect(commandsOf().website).toBe(before.website)
    expect(commandsOf().role).toBe(before.role)
  })

  it('changes with the workspace: the params value, every family, and the path', async () => {
    await mount()
    const before = latest().params

    const renders = await observe(() => controls.showWorkspace(B))

    const after = latest().params
    expect(renders.length).toBeGreaterThan(0)
    expect(after).not.toBe(before)
    expect(after.commands).not.toBe(before.commands)
    expect(after.commands.window).not.toBe(before.commands.window)
    expect(after.commands.terminal).not.toBe(before.commands.terminal)
    expect(after.commands.note).not.toBe(before.commands.note)
    expect(after.commands.website).not.toBe(before.commands.website)
    expect(after.commands.role).not.toBe(before.commands.role)
    expect(after.workspacePath).toBe(`/tmp/${B}`)
    // The other five preferences are the settings', and the settings are the app's.
    expect(after.onShowMessage).toBe(before.onShowMessage)
    expect(after.agentProviderOrder).toBe(before.agentProviderOrder)
    expect(after.defaultProvider).toBe(before.defaultProvider)
    expect(after.browserDefaultMode).toBe(before.browserDefaultMode)
    expect(after.browserSearchEngine).toBe(before.browserSearchEngine)
  })

  // The calibration is read when a command runs: the owner flips it through `null` on each re-check.
  it('keeps the commands and the params value across a calibration flip, through null and back', async () => {
    await mount()
    const before = latest()
    for (const next of [terminalCalibration(9), null, terminalCalibration(12), null]) {
      const renders = await observe(() => controls.setCalibration(next))
      for (const snapshot of renders) {
        expect(snapshot.params).toBe(before.params)
        expect(snapshot.params.commands).toBe(before.params.commands)
      }
    }
    expect(commandsOf().terminal).toBe(before.params.commands.terminal)
  })

  // The path and the environment are bound by the render (the launch's mount and env): rare. The
  // terminal and role commands launch with them.
  it('changes the terminal and role families and the object, and no other family, with an environment edit', async () => {
    await mount()
    const before = commandsOf()

    await observe(() => controls.setEnv({ EDITED: '1' }))

    expect(commandsOf()).not.toBe(before)
    expect(commandsOf().terminal).not.toBe(before.terminal)
    expect(commandsOf().role).not.toBe(before.role)
    expect(commandsOf().window).toBe(before.window)
    expect(commandsOf().note).toBe(before.note)
    expect(commandsOf().website).toBe(before.website)
  })

  it('changes a preference only when its content changes', async () => {
    await mount()
    const before = latest().params

    await settingsWith({
      browserDefaultMode: before.browserDefaultMode === 'iframe' ? 'native' : 'iframe',
    })

    const after = latest().params
    expect(after).not.toBe(before)
    expect(after.browserDefaultMode).not.toBe(before.browserDefaultMode)
    // The commands are not a preference: they keep their identity through it.
    expect(after.commands).toBe(before.commands)
    expect(after.agentProviderOrder).toBe(before.agentProviderOrder)
  })
})
