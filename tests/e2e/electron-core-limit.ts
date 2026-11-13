import { createRequire } from 'node:module'
import path from 'node:path'

export function resolveElectronCoreLimitLaunch(
  enabled: boolean,
  platform: NodeJS.Platform = process.platform,
) {
  if (!enabled || platform !== 'linux') {
    return undefined
  }
  const require = createRequire(__filename)
  return {
    executablePath: path.resolve(__dirname, 'fixtures/electron-one-byte-core.sh'),
    env: {
      OPENCOVE_TEST_ELECTRON_EXECUTABLE: require('electron') as string,
      // Playwright 1.58 omits its normal loader when executablePath is supplied.
      // Retain that loader's ready handshake and Chromium switches with the wrapper.
      OPENCOVE_TEST_PLAYWRIGHT_LOADER: path.join(
        path.dirname(require.resolve('playwright-core/package.json')),
        'lib/server/electron/loader.js',
      ),
    },
  }
}
