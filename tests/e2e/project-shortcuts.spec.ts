import { expect, test } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'

const projectShortcutModifier = process.platform === 'darwin' ? 'Meta' : 'Control'

test.describe('Project shortcuts', () => {
  test('switches projects in sidebar order with Cmd/Ctrl plus a number', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'project-shortcut-a',
        workspaces: ['a', 'b', 'c'].map(suffix => ({
          id: `project-shortcut-${suffix}`,
          name: `Project ${suffix.toUpperCase()}`,
          path: `${testWorkspacePath}-${suffix}`,
          nodes: [],
        })),
      })

      const projectA = window.getByTestId('workspace-item-project-shortcut-a')
      const projectB = window.getByTestId('workspace-item-project-shortcut-b')
      const projectC = window.getByTestId('workspace-item-project-shortcut-c')
      await expect(projectA).toHaveAttribute('aria-current', 'page')

      await window.keyboard.press(`${projectShortcutModifier}+2`)
      await expect(projectB).toHaveAttribute('aria-current', 'page')
      await expect(projectA).not.toHaveAttribute('aria-current', 'page')

      await window.keyboard.press(`${projectShortcutModifier}+3`)
      await expect(projectC).toHaveAttribute('aria-current', 'page')
    } finally {
      await electronApp.close()
    }
  })

  test('does not switch projects while a text editor is focused', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'project-shortcut-input-a',
        workspaces: ['a', 'b'].map(suffix => ({
          id: `project-shortcut-input-${suffix}`,
          name: `Project ${suffix.toUpperCase()}`,
          path: `${testWorkspacePath}-input-${suffix}`,
          nodes: [],
        })),
      })

      await window.keyboard.press(`${projectShortcutModifier}+P`)
      const commandInput = window.getByTestId('command-center-input')
      await expect(commandInput).toBeFocused()

      await window.keyboard.press(`${projectShortcutModifier}+2`)
      await expect(window.getByTestId('workspace-item-project-shortcut-input-a')).toHaveAttribute(
        'aria-current',
        'page',
      )
      await expect(
        window.getByTestId('workspace-item-project-shortcut-input-b'),
      ).not.toHaveAttribute('aria-current', 'page')
    } finally {
      await electronApp.close()
    }
  })
})
