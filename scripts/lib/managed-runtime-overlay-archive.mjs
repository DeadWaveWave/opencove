import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const quote = value => `'${value.replaceAll("'", "'\\''")}'`

/** Windows filesystems cannot retain Unix archive modes; re-extract the verified base in WSL. */
export function archiveManagedRuntimeOverlay({ base, staging, bundleName, archive }) {
  const run = (command, args, input) => {
    const result = spawnSync(command, args, { input, encoding: 'utf8', windowsHide: true })
    if (result.error || result.status !== 0) {
      throw (
        result.error ??
        new Error(result.stderr || result.stdout || `${command} exited ${result.status}`)
      )
    }
    return result.stdout.trim()
  }
  if (process.platform !== 'win32') {
    run('tar', ['-czf', archive, '-C', staging, bundleName])
    return
  }
  const distribution = process.env.OPENCOVE_WSL_DISTRIBUTION
  const wslArgs = distribution ? ['--distribution', distribution, '--exec'] : ['--exec']
  const unix = path => run('wsl', [...wslArgs, 'wslpath', '-a', path])
  const basePath = unix(base)
  const appPath = unix(join(staging, bundleName, 'app'))
  const archivePath = unix(archive)
  run(
    'wsl',
    [...wslArgs, 'sh', '-s'],
    `set -eu
stage=$(mktemp -d /tmp/opencove-overlay.XXXXXX)
case "$stage" in /tmp/opencove-overlay.*) ;; *) exit 1 ;; esac
trap 'rm -rf -- "$stage"' EXIT INT TERM
tar -xzf ${quote(basePath)} -C "$stage"
app="$stage/"${quote(`${bundleName}/app`)}
rm -rf -- "$app/out" "$app/src/app/cli"
cp -R ${quote(`${appPath}/out`)} "$app/out"
cp -R ${quote(`${appPath}/src/app/cli`)} "$app/src/app/cli"
cp ${quote(`${appPath}/package.json`)} "$app/package.json"
tar -czf ${quote(archivePath)} -C "$stage" ${quote(bundleName)}
`,
  )
}
