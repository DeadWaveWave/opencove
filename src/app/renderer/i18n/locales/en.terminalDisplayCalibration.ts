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
  clientCalibrated:
    'Saved adjustment is active: font {{fontSize}}px, line height {{lineHeight}}. Match: {{quality}}.',
  clientCalibrationPaused:
    'A saved adjustment is available but paused. Turn on Apply Calibration Automatically to use it. Match: {{quality}}.',
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
}
