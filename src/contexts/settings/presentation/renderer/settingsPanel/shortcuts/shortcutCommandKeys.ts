import type { CommandId } from '@contexts/settings/domain/keybindings'

export function getCommandTitleKey(commandId: CommandId): string {
  switch (commandId) {
    case 'commandCenter.toggle':
      return 'settingsPanel.shortcuts.commands.commandCenterToggle.title'
    case 'app.openSettings':
      return 'settingsPanel.shortcuts.commands.openSettings.title'
    case 'app.togglePrimarySidebar':
      return 'settingsPanel.shortcuts.commands.togglePrimarySidebar.title'
    case 'workspace.addProject':
      return 'settingsPanel.shortcuts.commands.addProject.title'
    case 'workspace.search':
      return 'settingsPanel.shortcuts.commands.workspaceSearch.title'
    case 'workspaceCanvas.createSpace':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCreateSpace.title'
    case 'workspaceCanvas.createNote':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCreateNote.title'
    case 'workspaceCanvas.createTerminal':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCreateTerminal.title'
    case 'workspaceCanvas.cycleSpacesForward':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCycleSpacesForward.title'
    case 'workspaceCanvas.cycleSpacesBackward':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCycleSpacesBackward.title'
    case 'workspaceCanvas.cycleIdleSpacesForward':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCycleIdleSpacesForward.title'
    case 'workspaceCanvas.cycleIdleSpacesBackward':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCycleIdleSpacesBackward.title'
    case 'workspaceCanvas.navigateNodeLeft':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateNodeLeft.title'
    case 'workspaceCanvas.navigateNodeRight':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateNodeRight.title'
    case 'workspaceCanvas.navigateNodeUp':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateNodeUp.title'
    case 'workspaceCanvas.navigateNodeDown':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateNodeDown.title'
    case 'workspaceCanvas.navigateSpaceLeft':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateSpaceLeft.title'
    case 'workspaceCanvas.navigateSpaceRight':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateSpaceRight.title'
    case 'workspaceCanvas.navigateSpaceUp':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateSpaceUp.title'
    case 'workspaceCanvas.navigateSpaceDown':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateSpaceDown.title'
    default: {
      const _exhaustive: never = commandId
      return _exhaustive
    }
  }
}

export function getCommandHelpKey(commandId: CommandId): string {
  switch (commandId) {
    case 'commandCenter.toggle':
      return 'settingsPanel.shortcuts.commands.commandCenterToggle.help'
    case 'app.openSettings':
      return 'settingsPanel.shortcuts.commands.openSettings.help'
    case 'app.togglePrimarySidebar':
      return 'settingsPanel.shortcuts.commands.togglePrimarySidebar.help'
    case 'workspace.addProject':
      return 'settingsPanel.shortcuts.commands.addProject.help'
    case 'workspace.search':
      return 'settingsPanel.shortcuts.commands.workspaceSearch.help'
    case 'workspaceCanvas.createSpace':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCreateSpace.help'
    case 'workspaceCanvas.createNote':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCreateNote.help'
    case 'workspaceCanvas.createTerminal':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCreateTerminal.help'
    case 'workspaceCanvas.cycleSpacesForward':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCycleSpacesForward.help'
    case 'workspaceCanvas.cycleSpacesBackward':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCycleSpacesBackward.help'
    case 'workspaceCanvas.cycleIdleSpacesForward':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCycleIdleSpacesForward.help'
    case 'workspaceCanvas.cycleIdleSpacesBackward':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCycleIdleSpacesBackward.help'
    case 'workspaceCanvas.navigateNodeLeft':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateNodeLeft.help'
    case 'workspaceCanvas.navigateNodeRight':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateNodeRight.help'
    case 'workspaceCanvas.navigateNodeUp':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateNodeUp.help'
    case 'workspaceCanvas.navigateNodeDown':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateNodeDown.help'
    case 'workspaceCanvas.navigateSpaceLeft':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateSpaceLeft.help'
    case 'workspaceCanvas.navigateSpaceRight':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateSpaceRight.help'
    case 'workspaceCanvas.navigateSpaceUp':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateSpaceUp.help'
    case 'workspaceCanvas.navigateSpaceDown':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateSpaceDown.help'
    default: {
      const _exhaustive: never = commandId
      return _exhaustive
    }
  }
}
