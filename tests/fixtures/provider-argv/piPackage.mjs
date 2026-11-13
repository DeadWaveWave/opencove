// Pi 0.80.7 dist/package-manager-cli.js:140; parser only, no handlers.
export function parsePackageCommand(args) {
  const [rawCommand, ...rest] = args
  let command
  if (rawCommand === 'uninstall') {
    command = 'remove'
  } else if (
    rawCommand === 'install' ||
    rawCommand === 'remove' ||
    rawCommand === 'update' ||
    rawCommand === 'list'
  ) {
    command = rawCommand
  }
  if (!command) {
    return undefined
  }
  let local = false
  let force = false
  let projectTrustOverride
  let help = false
  let invalidOption
  let invalidArgument
  let missingOptionValue
  let conflictingOptions
  let source
  let selfFlag = false
  let extensionsFlag = false
  let allFlag = false
  let extensionFlagSource
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index]
    if (arg === '-h' || arg === '--help') {
      help = true
      continue
    }
    if (arg === '-l' || arg === '--local') {
      if (command === 'install' || command === 'remove') {
        local = true
      } else {
        invalidOption = invalidOption ?? arg
      }
      continue
    }
    if (arg === '--self') {
      if (command === 'update') {
        selfFlag = true
      } else {
        invalidOption = invalidOption ?? arg
      }
      continue
    }
    if (arg === '--extensions') {
      if (command === 'update') {
        extensionsFlag = true
      } else {
        invalidOption = invalidOption ?? arg
      }
      continue
    }
    if (arg === '--all') {
      if (command === 'update') {
        allFlag = true
      } else {
        invalidOption = invalidOption ?? arg
      }
      continue
    }
    if (arg === '--approve' || arg === '-a') {
      projectTrustOverride = true
      continue
    }
    if (arg === '--no-approve' || arg === '-na') {
      projectTrustOverride = false
      continue
    }
    if (arg === '--force') {
      if (command === 'update') {
        force = true
      } else {
        invalidOption = invalidOption ?? arg
      }
      continue
    }
    if (arg === '--extension') {
      if (command !== 'update') {
        invalidOption = invalidOption ?? arg
        continue
      }
      const value = rest[index + 1]
      if (!value || value.startsWith('-')) {
        missingOptionValue = missingOptionValue ?? arg
      } else if (extensionFlagSource) {
        conflictingOptions = conflictingOptions ?? '--extension can only be provided once'
        index++
      } else {
        extensionFlagSource = value
        index++
      }
      continue
    }
    if (arg.startsWith('-')) {
      invalidOption = invalidOption ?? arg
      continue
    }
    if (!source) {
      source = arg
    } else {
      invalidArgument = invalidArgument ?? arg
    }
  }
  let updateTarget
  let showExtensionsSkippedNote = false
  if (command === 'update') {
    if (allFlag && (selfFlag || extensionsFlag || extensionFlagSource)) {
      conflictingOptions =
        conflictingOptions ?? '--all cannot be combined with --self, --extensions, or --extension'
    }
    if (allFlag && source) {
      conflictingOptions = conflictingOptions ?? '--all cannot be combined with a positional source'
    }
    if (extensionFlagSource) {
      if (selfFlag || extensionsFlag || allFlag) {
        conflictingOptions =
          conflictingOptions ?? '--extension cannot be combined with --self, --extensions, or --all'
      }
      if (source) {
        conflictingOptions =
          conflictingOptions ?? '--extension cannot be combined with a positional source'
      }
      updateTarget = { type: 'extensions', source: extensionFlagSource }
    } else if (source) {
      const sourceIsSelf = source === 'self' || source === 'pi'
      if (sourceIsSelf) {
        updateTarget = extensionsFlag ? { type: 'all' } : { type: 'self' }
      } else {
        if (extensionsFlag || selfFlag || allFlag) {
          conflictingOptions =
            conflictingOptions ??
            'positional update targets cannot be combined with --self, --extensions, or --all'
        }
        updateTarget = { type: 'extensions', source }
      }
    } else if (allFlag) {
      updateTarget = { type: 'all' }
    } else if (selfFlag && extensionsFlag) {
      updateTarget = { type: 'all' }
    } else if (selfFlag) {
      updateTarget = { type: 'self' }
    } else if (extensionsFlag) {
      updateTarget = { type: 'extensions' }
    } else {
      updateTarget = { type: 'self' }
      showExtensionsSkippedNote = true
    }
  }
  return {
    command,
    source,
    updateTarget,
    showExtensionsSkippedNote,
    local,
    force,
    projectTrustOverride,
    help,
    invalidOption,
    invalidArgument,
    missingOptionValue,
    conflictingOptions,
  }
}
