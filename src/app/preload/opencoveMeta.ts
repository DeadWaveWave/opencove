import { resolveMainProcessPid } from './mainProcessPid'
import { resolveWindowsPtyMeta } from './windowsPtyMeta'

export function resolveOpenCoveMeta() {
  return {
    isTest: process.env.NODE_ENV === 'test',
    isPackaged: process.env.NODE_ENV !== 'test' && process.defaultApp !== true,
    allowWhatsNewInTests: process.env.OPENCOVE_TEST_WHATS_NEW === '1',
    enableTerminalDiagnostics: process.env.OPENCOVE_TERMINAL_DIAGNOSTICS === '1',
    enableTerminalInputDiagnostics: process.env.OPENCOVE_TERMINAL_INPUT_DIAGNOSTICS === '1',
    enableTerminalTestApi: process.env.OPENCOVE_TERMINAL_TEST_API === '1',
    runtime: 'electron' as const,
    platform: process.platform,
    mainPid: resolveMainProcessPid(),
    windowsPty: resolveWindowsPtyMeta(),
  }
}
