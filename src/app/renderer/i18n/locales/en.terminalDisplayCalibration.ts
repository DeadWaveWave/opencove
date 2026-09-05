export const enTerminalDisplayCalibration = {
  title: 'Terminal Display Consistency',
  help: 'Use these controls when terminal text looks larger or smaller between Desktop and Web UI.',
  autoReferenceLabel: 'Set Reference Automatically',
  autoReferenceHelp:
    'When no target exists yet, use the first opened terminal as the display target for other clients.',
  compensationLabel: 'Apply Calibration Automatically',
  compensationHelp:
    'Use the saved adjustment for this device so it matches the target display. Turn this off to use the raw terminal font settings. Terminals still fit their windows when calibration is off.',
  referenceLabel: 'Shared Reference Target',
  referenceEmpty:
    'No target has been saved yet. The first opened terminal will become the target automatically, or you can set this device manually.',
  referenceEmptyAutoOff:
    'No target has been saved yet. Automatic setup is off, so set this device manually when you are ready.',
  referenceStale:
    'The saved target uses an older measurement or a different terminal font setting. Keep the anchor client open to refresh it automatically, or set a new target.',
  referenceSummary: '{{cols}}×{{rows}} cells, {{cellWidth}}×{{cellHeight}} px cell.',
  setReference: 'Use This Device as Target',
  clientLabel: 'This Device',
  clientDefault: 'No saved adjustment for this device. It uses the shared terminal font as-is.',
  clientCalibrationDisabled:
    'Calibration is off and this device has no saved adjustment. It uses the shared terminal font settings.',
  clientCalibrationDisabledUnavailable:
    'Calibration is off. A saved adjustment exists but cannot safely match the current target. Clear it or enable calibration to replace it.',
  clientCalibrationUnavailable:
    'A saved adjustment exists but cannot safely match the current target. Clear it or let automatic calibration replace it.',
  clientCalibrationWaiting:
    'Calibration is on. The saved adjustment is waiting for a matching display environment. Terminals still fit their windows automatically.',
  clientCalibrated:
    'Saved adjustment is active: font {{fontSize}}px, line height {{lineHeight}}. Match: {{quality}}.',
  clientCalibrationPaused:
    'A saved adjustment is available but paused. Turn on Apply Calibration Automatically to use it. Match: {{quality}}.',
  state: {
    checking: 'Checking the current terminal display before applying calibration.',
    referenceUnavailable: 'Set a current shared reference target before applying calibration.',
    noTerminal: 'Open a terminal to verify and apply the saved display adjustment.',
    mixedRenderers:
      'Open terminals use different display methods, so a shared adjustment cannot be applied. Terminals still fit their windows automatically.',
    rendererMismatch:
      'This device uses a different display method from the reference target. Set a compatible target to apply calibration.',
    environmentUnstable:
      'The terminal display has not stabilized. Try calibrating again after it finishes loading.',
    suppressed:
      'Automatic calibration is paused after clearing the adjustment. Calibrate this device manually to resume.',
    measurementUnavailable:
      'Terminal display measurement failed. Try calibrating this device again.',
    candidateRejected:
      'The current display cannot match the reference target closely enough. Set a compatible target to apply calibration.',
    storageUnavailable: 'The display adjustment could not be saved. It has not been applied.',
  },
  quality: {
    exact: 'Exact',
    close: 'Close',
    needsAdjustment: 'Needs adjustment',
  },
  calibrate: 'Calibrate This Device',
  reset: 'Clear Device Adjustment',
  diagnosticsLabel: 'Diagnostics',
  diagnosticsHelp: 'Copy a report if Desktop and Web UI still look different.',
  copyDiagnostics: 'Copy Diagnostics',
  referenceSaved:
    'Target saved. Open another client and calibrate that device against this target.',
  referenceRequired: 'Set a shared target before calibrating this device.',
  calibrationSaved: 'Device adjustment saved. Match: {{quality}}.',
  calibrationUnmatchable:
    'This renderer cannot safely match the current target. No adjustment was applied. Match: {{quality}}. Refresh or replace the shared target.',
  resetDone: 'The saved adjustment for this device was cleared.',
  diagnosticsCopied: 'Terminal display diagnostics copied.',
  measureFailed: 'Unable to measure terminal display metrics on this device.',
  storageFailed: 'Unable to save the terminal display adjustment on this device.',
}
