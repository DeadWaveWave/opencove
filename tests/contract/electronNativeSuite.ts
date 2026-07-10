import { describe } from 'vitest'

/** Native persistence contracts run under Electron's Node ABI; the default Node suite skips them. */
export const describeWithElectronNativeModules = process.versions.electron
  ? describe
  : describe.skip
