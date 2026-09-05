const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

// Check the packaged native module with the Electron runtime that will actually ship.
module.exports = async function verifyWindowsTerminalCapability(context) {
  if (context.electronPlatformName !== 'win32' || process.platform !== 'win32') {
    return
  }
  const manifest = join(context.appOutDir, 'resources', 'app.asar', 'package.json')
  const executable = join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)
  const script = [
    `JSON.parse(require('node:fs').readFileSync(${JSON.stringify(manifest)}, 'utf8'))`,
    `const requireFromApp = require('node:module').createRequire(${JSON.stringify(manifest)})`,
    "requireFromApp('node-pty/lib/windowsConsoleGeometry').assertWindowsConsoleGeometryAvailable()",
    "process.stdout.write('Packaged Windows Console geometry capability verified\\n')",
  ].join(';')
  const output = execFileSync(executable, ['-e', script], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    windowsHide: true,
    timeout: 10_000,
    encoding: 'utf8',
  })
  process.stdout.write(output)
}
