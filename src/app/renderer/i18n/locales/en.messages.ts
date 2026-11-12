import { agentSpawnPresentations } from '../../../../shared/errors/agentSpawnError'
export const enMessages = {
  ownedNodeChanged: 'This node has changed. Refresh the workspace and try again.',
  taskClosed: 'This task is closed. Reopen it before claiming it.',
  taskClaimed: 'This task is already claimed by another agent.',
  taskHolderBusy: 'This agent already holds another open task.',
  taskStale: 'This task has changed. Refresh it before trying again.',
  taskTextStale: 'This note has changed. Review the latest text before saving your draft.',
  taskTextTooLarge: 'This change would exceed the note size limit of 1 MiB.',
  taskRequestMismatch:
    'This request ID was already used with different input. Use a new request ID for a new change.',
  taskLegacyConflict:
    'Multiple tasks are linked to this agent. Resolve the existing links before claiming a task.',

  agentSpawnDepth: agentSpawnPresentations.agentSpawnDepth.message,
  agentSpawnDepthHint: agentSpawnPresentations.agentSpawnDepth.hint,
  agentSpawnConcurrency: agentSpawnPresentations.agentSpawnConcurrency.message,
  agentSpawnConcurrencyHint: agentSpawnPresentations.agentSpawnConcurrency.hint,
  agentSpawnRoute: agentSpawnPresentations.agentSpawnRoute.message,
  agentSpawnRouteHint: agentSpawnPresentations.agentSpawnRoute.hint,
  agentSpawnCaller: agentSpawnPresentations.agentSpawnCaller.message,
  agentSpawnCallerHint: agentSpawnPresentations.agentSpawnCaller.hint,
  agentSpawnBinding: agentSpawnPresentations.agentSpawnBinding.message,
  agentSpawnBindingHint: agentSpawnPresentations.agentSpawnBinding.hint,
  agentSpawnRemote: agentSpawnPresentations.agentSpawnRemote.message,
  agentSpawnRemoteHint: agentSpawnPresentations.agentSpawnRemote.hint,
  agentSpawnAccounting: agentSpawnPresentations.agentSpawnAccounting.message,
  agentSpawnAccountingHint: agentSpawnPresentations.agentSpawnAccounting.hint,
  agentSpawnCapability: agentSpawnPresentations.agentSpawnCapability.message,
  agentSpawnCapabilityHint: agentSpawnPresentations.agentSpawnCapability.hint,
  managedAgentClearSaveUnconfirmed:
    'The latest Claude conversation could not be confirmed. Try resuming again before closing this agent.',
  managedAgentWorkerUpgradeRequired:
    'Update and restart the connected Worker before managing Claude agents. Updating this window alone is not enough.',
  managedAgentClientUpgradeRequired:
    'Update OpenCove and reload this window before controlling this agent.',
  managedAgentWritesDisabled:
    'Managed Claude restarts and saving new resume targets are paused. Existing saved targets remain protected. Ask the Worker administrator to enable updates.',
  workerConnectionRetry: 'Retry connection',
  managedAgentLegacyWorker:
    'This Worker uses legacy Claude sessions. Your workspace remains available. Upgrade and restart the Worker to enable managed recovery.',
  managedAgentChanged: 'This agent has changed. Refresh the workspace and try again.',
  managedAgentDirectoryConflict:
    'This agent belongs to a different folder. Keep its current folder or start a new agent.',
  managedAgentLaunchUncertain:
    'The agent launch could not be confirmed. Check the session before trying again.',
  managedAgentResumeUnavailable:
    'This conversation cannot be resumed yet. Select a saved session or start a new conversation.',
  nodeNoParent: 'This node was started by the user, so it has no parent agent.',
  nodeNoParentHint:
    'Use "opencove agent list" to choose a recipient, or report your findings to the user.',
  nodeParentDeleted: 'The agent that created this node has been deleted.',
  nodeParentDeletedHint:
    'Use "opencove agent list" to choose another recipient, or leave your findings in a shared note.',
  nodeParentIdentityMismatch: 'The current terminal identity does not match its OpenCove session.',
  nodeParentIdentityMismatchHint:
    'Open a new OpenCove terminal and run "opencove whoami" before choosing a recipient.',
  nodeParentIdentityRequired: '@parent works only inside an OpenCove terminal.',
  nodeParentIdentityRequiredHint:
    'Run this command inside OpenCove, or replace @parent with a node ID from "opencove node list".',
  nodeParentUnavailable: 'The parent node could not be resolved.',
  nodeParentUnavailableHint:
    'Run "opencove node get --node @self" to inspect your lineage, then choose a recipient with "opencove node list".',
  agentLaunchFailed: 'Agent launch failed: {{message}}',
  agentResumeFailed: 'Agent resume failed: {{message}}',
  terminalAgentReexecFailed: 'Failed to restart the agent in this terminal: {{message}}',
  terminalAgentReexecTimeout:
    'The agent did not return to the terminal prompt, so no command was entered.',
  terminalLaunchFailed: 'Terminal launch failed: {{message}}',
  fallbackTerminalFailed: 'Fallback terminal launch also failed: {{message}}',
  agentPromptRequired: 'Agent prompt cannot be empty.',
  taskRequirementRequired: 'Task requirement cannot be empty.',
  taskTitleGenerateFailed: 'Auto-generation failed: {{message}}',
  taskCreateFailed: 'Failed to create task: {{message}}',
  taskUpdateFailed: 'Failed to update task: {{message}}',
  taskNodePlacementFailed: 'Task node cannot be placed. Tidy the canvas and try again.',
  taskTitleOrAutoGenerateRequired: 'Enter a task title or enable auto-generation.',
  taskTitleRequired: 'Enter a task title.',
  taskPromptTemplateNameRequired: 'Template name cannot be empty.',
  taskPromptTemplateContentRequired: 'Template content cannot be empty.',
  taskPromptTemplateNameTaken: 'A template with this name already exists.',
  taskPromptTemplateProjectUnavailable: 'Project templates are unavailable.',
  taskLinkedAgentWindowOpen: 'Close the currently linked agent window before continuing.',
  taskResumeSessionMissing:
    'This agent record does not have a verified resumeSessionId, so it cannot resume.',
  resumeSessionMissing: 'This agent does not have a verified resumeSessionId yet.',
  noTerminalSlotNearby:
    'No room nearby in the current view. Move or close some terminal windows first.',
  noWindowSlotOnRight:
    'No room to the right of the current agent. Move or close some windows first.',
  noWindowSlotNearby: 'No room nearby in the current view. Move or close some windows first.',
  arrangeAllSkippedSpaces_one: 'Skipped {{count}} space: not enough room to arrange.',
  arrangeAllSkippedSpaces_other: 'Skipped {{count}} spaces: not enough room to arrange.',
  arrangeSpaceNoRoom: 'Not enough room to arrange this space. Resize the space and try again.',
  noteToTaskRequiresContent: 'Cannot convert an empty note into a task.',
  noteMarkdownSaved: 'Saved {{fileName}}.',
  noteMarkdownDownloadStarted: 'Download started for {{fileName}}.',
  noteMarkdownDownloadFailed: 'Failed to download note: {{message}}',
  agentLastMessageUnavailable:
    'The current agent is unavailable, so the last message cannot be copied.',
  agentLastMessageStartedAtMissing:
    'The current agent is missing its session start time, so the last message cannot be copied.',
  agentLastMessageEmpty: 'The current agent does not have a last message to copy yet.',
  agentLastMessageCopied: 'The last agent message was copied.',
  agentLastMessageCopyFailed: 'Failed to copy the last agent message: {{message}}',
  agentSpaceDirectoryMismatch:
    'Agent windows cannot enter or leave a space with a different directory.',
  terminalSpaceDirectoryMismatch:
    'Terminal windows cannot enter or leave a space with a different directory.',
  taskSpaceMoveBlocked: 'Tasks with active agents cannot be moved between spaces.',
  spaceRequiresNode: 'Space must include at least one task or agent.',
  childSpaceCreateFailed: 'Failed to create Space.',
  childSpaceRequiresSelection: 'Select windows inside one space first.',
  childSpaceRequiresParent: 'Space can only be created from windows inside one parent space.',
  projectHasNoMounts: 'Project has no mounts yet. Add a mount first.',
  projectNoLocalLocationToOpen: 'This project does not have a local location to open.',
  projectOpenInFileManagerFailed: 'Failed to open the project in the file manager: {{message}}',
  mountListFailed: 'Failed to load mounts: {{message}}',
  canvasImageUnsupportedType: 'Unsupported image type. Use PNG, JPEG, WebP, GIF, or AVIF.',
  canvasImageTooLarge: 'Image is too large (max {{maxMb}} MB).',
  canvasImageImportFailed: 'Failed to import image: {{message}}',
} as const
