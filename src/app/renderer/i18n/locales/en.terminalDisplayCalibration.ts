export const enTerminalDisplayCalibration = {
  title: 'Terminal Display Consistency',
  help: 'Keep terminal cells visually aligned across Desktop, Web UI, and future clients.',
  autoCalibrationLabel: 'Automatic Display Alignment',
  autoCalibrationHelp:
    'When no reference exists, use the first online client as the shared reference. This never resizes running terminals.',
  referenceLabel: 'Shared Reference',
  referenceEmpty:
    'No reference has been saved yet. The first online client is used automatically, or you can set this client manually.',
  referenceEmptyAutoOff:
    'No reference has been saved yet. Automatic alignment is off, so set this client manually when you are ready.',
  referenceStale:
    'The saved reference belongs to a different terminal appearance. Set a new reference before calibrating.',
  referenceSummary: '{{cols}}×{{rows}} cells, {{cellWidth}}×{{cellHeight}} px cell.',
  setReference: 'Set This Client as Reference',
  clientLabel: 'This Client',
  clientDefault: 'Using the shared terminal appearance with no local compensation.',
  clientCalibrated:
    'Using local compensation: font {{fontSize}}px, line height {{lineHeight}}. Display match: {{quality}}.',
  quality: {
    exact: 'Exact',
    close: 'Close',
    needsAdjustment: 'Needs adjustment',
  },
  calibrate: 'Calibrate This Client',
  reset: 'Reset This Client',
  diagnosticsLabel: 'Diagnostics',
  diagnosticsHelp: 'Copy a report when Desktop and Web UI still do not match.',
  copyDiagnostics: 'Copy Diagnostics',
  referenceSaved: 'Reference saved. Open another client and calibrate it against this target.',
  referenceRequired: 'Set a shared reference before calibrating this client.',
  calibrationSaved: 'Calibration saved for this client. Display match: {{quality}}.',
  resetDone: 'Local terminal display calibration was reset.',
  diagnosticsCopied: 'Terminal display diagnostics copied.',
  measureFailed: 'Unable to measure terminal display metrics on this client.',
}
