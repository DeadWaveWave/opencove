import { describe, expect, it } from 'vitest'

import {
  STANDALONE_GLIBC_FLOOR,
  formatFloorViolations,
  parseVersionedSymbolRequirements,
  resolveGlibcFloorArtifacts,
  resolveNativeModuleRebuildCommand,
  resolveReadelfInvocation,
  selectFloorViolations,
} from '../../../scripts/lib/standalone-glibc-floor.mjs'

/**
 * Abridged `readelf --dynamic --version-info` shape. The GLIBC_2.38 line is the exact requirement
 * that broke nightly run 32229590172 inside debian:bookworm-slim.
 */
const readelfWithTooNewGlibc = `
Dynamic section at offset 0x2d000 contains 27 entries:
  Tag        Type                         Name/Value
 0x0000000000000001 (NEEDED)             Shared library: [libm.so.6]
 0x0000000000000001 (NEEDED)             Shared library: [libstdc++.so.6]

Version needs section '.gnu.version_r' contains 3 entries:
 0x0000: Version: 1  File: libm.so.6  Cnt: 2
  0x0010:   Name: GLIBC_2.29  Flags: none  Version: 4
  0x0020:   Name: GLIBC_2.38  Flags: none  Version: 5
 0x0030: Version: 1  File: libc.so.6  Cnt: 2
  0x0040:   Name: GLIBC_2.17  Flags: none  Version: 2
  0x0050:   Name: GLIBC_2.28  Flags: none  Version: 3
 0x0060: Version: 1  File: libstdc++.so.6  Cnt: 1
  0x0070:   Name: GLIBCXX_3.4.21  Flags: none  Version: 6
`

const readelfWithinFloor = `
Version needs section '.gnu.version_r' contains 2 entries:
 0x0000: Version: 1  File: libc.so.6  Cnt: 2
  0x0010:   Name: GLIBC_2.17  Flags: none  Version: 2
  0x0020:   Name: GLIBC_2.28  Flags: none  Version: 3
 0x0030: Version: 1  File: libstdc++.so.6  Cnt: 1
  0x0040:   Name: GLIBCXX_3.4.25  Flags: none  Version: 4
`

describe('standalone glibc floor', () => {
  it('declares every symbol family the glibc 2.28 baseline provides', () => {
    // Measured from AlmaLinux 8, the glibc 2.28 baseline itself. GLIBCXX_3.4.25 independently
    // reproduces the number VS Code publishes for its Linux server.
    expect(STANDALONE_GLIBC_FLOOR).toEqual({
      GLIBC: '2.28',
      GLIBCXX: '3.4.25',
      CXXABI: '1.3.11',
      GCC: '7.0.0',
    })
  })

  it('covers the families the bundled Node actually requires', () => {
    // Measured on the Node 22.23.2 linux-x64 binary: it needs CXXABI_1.3.9 and GCC_3.4 in addition
    // to GLIBC/GLIBCXX. A floor missing those families would either reject the very runtime we
    // ship, or -- with a narrower regex -- silently ignore those requirements altogether.
    const nodeRequirements = [
      { library: 'GLIBC', version: '2.28' },
      { library: 'GLIBCXX', version: '3.4.21' },
      { library: 'CXXABI', version: '1.3.9' },
      { library: 'GCC', version: '3.4' },
    ]

    expect(selectFloorViolations(nodeRequirements)).toEqual([])
  })

  it('parses any versioned symbol family, not a hardcoded pair', () => {
    const requirements = parseVersionedSymbolRequirements(
      '  Name: CXXABI_1.3.9  Flags: none\n  Name: GCC_3.4  Flags: none\n',
    )

    expect(requirements).toEqual([
      { library: 'CXXABI', version: '1.3.9' },
      { library: 'GCC', version: '3.4' },
    ])
  })

  it('flags a symbol family it has never been told about', () => {
    // Fail closed on the unknown: a new versioned dependency must not slip in unnoticed just
    // because nobody added it to the floor table.
    expect(selectFloorViolations([{ library: 'SOMETHINGNEW', version: '9.9' }])).toEqual([
      { library: 'SOMETHINGNEW', version: '9.9' },
    ])
  })

  it('parses versioned symbol requirements from readelf output', () => {
    const requirements = parseVersionedSymbolRequirements(readelfWithTooNewGlibc)

    expect(requirements).toContainEqual({ library: 'GLIBC', version: '2.38' })
    expect(requirements).toContainEqual({ library: 'GLIBCXX', version: '3.4.21' })
    // Must not invent requirements from the NEEDED lines.
    expect(requirements.some(entry => entry.library === 'libm')).toBe(false)
  })

  it('flags every requirement above the floor', () => {
    const violations = selectFloorViolations(
      parseVersionedSymbolRequirements(readelfWithTooNewGlibc),
    )

    // 2.29 and 2.38 both exceed 2.28; 2.17/2.28 and GLIBCXX_3.4.21 are within it.
    expect(violations).toEqual([
      { library: 'GLIBC', version: '2.29' },
      { library: 'GLIBC', version: '2.38' },
    ])
  })

  it('compares versions numerically, not lexicographically', () => {
    // '2.9' > '2.28' as strings, but 2.9 < 2.28 as a glibc version.
    expect(selectFloorViolations([{ library: 'GLIBC', version: '2.9' }])).toEqual([])
    // 3.4.9 < 3.4.25 numerically even though it sorts later as a string.
    expect(selectFloorViolations([{ library: 'GLIBCXX', version: '3.4.9' }])).toEqual([])
    expect(selectFloorViolations([{ library: 'GLIBCXX', version: '3.4.31' }])).toEqual([
      { library: 'GLIBCXX', version: '3.4.31' },
    ])
  })

  it('accepts artifacts that sit exactly on the floor', () => {
    expect(selectFloorViolations(parseVersionedSymbolRequirements(readelfWithinFloor))).toEqual([])
  })

  it('fails closed when no versioned symbols can be read', () => {
    // An empty parse means readelf gave us nothing usable. Treating that as "no violations"
    // would let an unverified artifact ship, so the caller must be told it is unusable.
    expect(() => parseVersionedSymbolRequirements('', { requireSymbols: true })).toThrow(
      /no versioned symbol/i,
    )
  })

  it('reports which library and version broke the floor', () => {
    const message = formatFloorViolations('better_sqlite3.node', [
      { library: 'GLIBC', version: '2.38' },
    ])

    expect(message).toContain('better_sqlite3.node')
    expect(message).toContain('GLIBC_2.38')
    expect(message).toContain('2.28')
  })
})

describe('glibc floor artifact scope', () => {
  const scope = {
    appRoot: '/bundle/app',
    bundledNodeExecutable: '/bundle/runtime/node/bin/node',
  }

  it('checks the natives we rebuild and the Node that must load them', () => {
    expect(resolveGlibcFloorArtifacts(scope)).toEqual([
      '/bundle/runtime/node/bin/node',
      '/bundle/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
      // node-pty's binary name does not match its package name.
      '/bundle/app/node_modules/node-pty/build/Release/pty.node',
    ])
  })

  it('excludes artifacts a glibc floor cannot describe', () => {
    const artifacts = resolveGlibcFloorArtifacts(scope)

    // These all ship inside a Linux bundle and are Mach-O / PE / musl-linked, so `readelf` reports
    // "not an ELF file" for them. Nightly run 32237855660 failed on exactly this set. Including
    // them would force the gate to tolerate unreadable files, which would then let a genuinely
    // unreadable glibc artifact pass as clean.
    for (const excluded of [
      'prebuilds/darwin-arm64',
      'prebuilds/win32-x64',
      'linux-x64-musl',
      // Intermediate link output, not what gets loaded.
      'obj.target',
      // better-sqlite3's optional test fixture, never loaded by the server.
      'test_extension',
    ]) {
      expect(artifacts.some(artifact => artifact.includes(excluded))).toBe(false)
    }
  })
})

describe('readelf invocation', () => {
  it('sizes the output buffer for the largest artifact we ship', () => {
    // `--version-info` prints one entry per dynamic symbol. The bundled Node binary is ~125 MB, so
    // the default 1 MB buffer overflows and execFileSync fails with ENOBUFS -- which is how nightly
    // run 32243087132 failed even though both native modules were already within the floor.
    const invocation = resolveReadelfInvocation('/bundle/runtime/node/bin/node')

    expect(invocation.command).toBe('readelf')
    expect(invocation.args).toEqual(['--version-info', '/bundle/runtime/node/bin/node'])
    expect(invocation.options.maxBuffer).toBeGreaterThan(64 * 1024 * 1024)
  })

  it('keeps stderr out of the parsed output', () => {
    // Parsed text must be symbol data only; a readelf warning merged into stdout could otherwise
    // be read as if it were symbol information.
    const invocation = resolveReadelfInvocation('/bundle/x.node')

    expect(invocation.options.stdio).toEqual(['ignore', 'pipe', 'pipe'])
  })
})

describe('native module rebuild command', () => {
  const base = {
    nodeExecutable: '/repo/dist/opencove-server-linux-x64/runtime/node/bin/node',
    nodeGypScript: '/repo/node_modules/.pnpm/node-gyp/bin/node-gyp.js',
    moduleCwd: '/repo/node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty',
    rootDir: '/repo',
  }

  it('runs node-gyp directly when no container image is configured', () => {
    const command = resolveNativeModuleRebuildCommand(base)

    expect(command.command).toBe(base.nodeExecutable)
    expect(command.args).toEqual([base.nodeGypScript, 'rebuild', '--release'])
    expect(command.cwd).toBe(base.moduleCwd)
  })

  it('runs node-gyp inside the configured old-glibc container', () => {
    const command = resolveNativeModuleRebuildCommand({
      ...base,
      containerImage: 'quay.io/pypa/manylinux_2_28_x86_64',
      hostUser: '1001:1001',
    })

    expect(command.command).toBe('docker')
    expect(command.args).toContain('quay.io/pypa/manylinux_2_28_x86_64')
    // The repo must be mounted at the identical path so realpath-based cwd stays valid.
    expect(command.args).toContain('--volume')
    expect(command.args).toContain('/repo:/repo')
    // Preserves #357's fix: node-gyp still runs from the module realpath.
    expect(command.args).toContain('--workdir')
    expect(command.args).toContain(base.moduleCwd)
    // Must not write root-owned files into the mounted workspace.
    expect(command.args).toContain('--user')
    expect(command.args).toContain('1001:1001')
    expect(command.args.slice(-3)).toEqual([base.nodeGypScript, 'rebuild', '--release'])
    // The bundled Node must still be what executes node-gyp inside the container.
    expect(command.args.at(-4)).toBe(base.nodeExecutable)
  })

  it('puts the bundled Node on PATH for binding.gyp actions that shell out to a bare `node`', () => {
    // better-sqlite3's `copy_builtin_sqlite3` action is literally ['node', 'copy.js', ...]. With no
    // `node` on PATH inside the image, make dies with an opaque `Error 127`.
    const command = resolveNativeModuleRebuildCommand({
      ...base,
      containerImage: 'quay.io/pypa/manylinux_2_28_x86_64',
      hostUser: '1001:1001',
    })

    // PATH must be prepended, never replaced: the image keeps its C++20 compiler on a toolset
    // path, and overwriting PATH loses the compiler instead (also an opaque Error 127).
    const script = command.args.find(argument => argument.includes('PATH='))
    expect(script).toBe('PATH="$1:$PATH"; export PATH; shift; exec "$@"')
    expect(command.args).toContain('/repo/dist/opencove-server-linux-x64/runtime/node/bin')
    expect(command.args.some(argument => argument.startsWith('PATH=/'))).toBe(false)
  })

  it('mounts the bundled Node when it lives outside the repository mount', () => {
    const command = resolveNativeModuleRebuildCommand({
      ...base,
      nodeExecutable: '/opt/bundled/bin/node',
      containerImage: 'quay.io/pypa/manylinux_2_28_x86_64',
    })

    expect(command.args).toContain('/opt/bundled/bin:/opt/bundled/bin')
  })

  it('does not add a redundant mount for a bundled Node already inside the repository', () => {
    const command = resolveNativeModuleRebuildCommand({
      ...base,
      containerImage: 'quay.io/pypa/manylinux_2_28_x86_64',
    })

    const mounts = command.args.filter((_, index) => command.args[index - 1] === '--volume')
    expect(mounts).toEqual(['/repo:/repo'])
  })

  it('keeps node-gyp caches inside the workspace so a non-root container user can write them', () => {
    const command = resolveNativeModuleRebuildCommand({
      ...base,
      containerImage: 'quay.io/pypa/manylinux_2_28_x86_64',
      hostUser: '1001:1001',
    })

    const env = command.args.filter((_, index) => command.args[index - 1] === '--env').join(' ')
    expect(env).toMatch(/npm_config_devdir=\/repo\b/)
    expect(env).toMatch(/HOME=\/repo\b/)
  })
})
