// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compilePluginThemeResources } from '../../../../src/contexts/plugins/infrastructure/compilePluginThemeResources'
import { LocalPluginFiles } from '../../../../src/contexts/plugins/infrastructure/LocalPluginFiles'
import { PluginInstallationManager } from '../../../../src/contexts/plugins/application/PluginInstallationManager'

let root: string
let source: string
const theme = {
  id: 'night',
  title: 'Night',
  appearance: 'dark' as const,
  tokens: { '--cove-accent': '#aabbcc' },
  stylesheet: 'styles/theme.css',
}
const manifest = {
  apiVersion: 1,
  id: 'theme-test',
  version: '1.0.0',
  displayName: 'Theme test',
  description: 'Theme resource fixture',
  contributes: { themes: [theme] },
}
const managers: PluginInstallationManager[] = []
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'opencove-theme-resources-'))
  source = join(root, 'source')
  await mkdir(join(source, 'styles'), { recursive: true })
  await mkdir(join(source, 'assets'), { recursive: true })
  await writeFile(join(source, 'opencove.plugin.json'), JSON.stringify(manifest))
  await writeFile(join(source, 'assets/dot.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
})
afterEach(async () => {
  await Promise.all(managers.splice(0).map(manager => manager.dispose()))
  await rm(root, { recursive: true, force: true })
})
async function compile(css: string) {
  await writeFile(join(source, theme.stylesheet), css)
  return await compilePluginThemeResources(source, manifest.id, [theme])
}

describe('theme styles from immutable plugin packages', () => {
  it('reports the package-relative stylesheet and line instead of an invented cwd path', async () => {
    await expect(compile('\n.broken {')).rejects.toThrow(
      'Theme "theme-test/night", stylesheet "styles/theme.css":2:1: Unclosed block',
    )
  })

  it('scopes root, html, body and comma-rich component selectors while preserving keyframe steps', async () => {
    const result = await compile(`
      :root, html { --texture: url('../assets/dot.svg'); }
      body .header:is([data-kind="a,b"], .node)::before { content: ""; animation: pulse 1s ease-in; }
      @media (prefers-reduced-motion: no-preference) { [data-cove-part="window-header"] { opacity:.8 } }
      @keyframes pulse { from { opacity:0 } 100% { opacity:1 } }
    `)
    const css = result.themeStyles!.night
    const scope = ':root[data-cove-theme-id="plugin:theme-test:night"]'
    expect(css).toContain(`${scope},${scope}`)
    expect(css).toContain(`${scope} body .header:is([data-kind="a,b"], .node)::before`)
    expect(css).toContain(`${scope} [data-cove-part="window-header"]`)
    expect(css).toMatch(/@keyframes (opencove-theme-[a-f0-9]+-pulse)/)
    const name = css.match(/@keyframes (\S+)/)![1]
    expect(css).toContain(`animation: ${name} 1s ease-in`)
    expect(css).toContain('from { opacity:0 }')
    expect(css).not.toContain(`${scope} from`)
    expect(css).toContain('data:image/svg+xml;base64,')
  })

  it('bundles sibling fonts/images and exposes unchanged font family to iframe consumers', async () => {
    await writeFile(join(source, 'assets/interface.woff2'), Buffer.from([1, 2, 3]))
    const result = await compile(`
      @font-face { font-family: "Interface Mono"; src: local("Interface Mono"), url(../assets/interface.woff2) format("woff2"); font-display: swap; font-weight: 100 900; }
      :root { --cove-ui-font-family: "Interface Mono"; --back: image-set("../assets/dot.svg" 1x, url(../assets/dot.svg) 2x); }
    `)
    expect(result.themeFonts!.night).toEqual([
      {
        family: 'Interface Mono',
        source: 'local("Interface Mono"), url("data:font/woff2;base64,AQID") format("woff2")',
        descriptors: { display: 'swap', weight: '100 900' },
      },
    ])
    expect(result.themeStyles!.night).toContain('font-family: "Interface Mono"')
    expect(result.themeStyles!.night).not.toContain('../assets')
  })

  it.each([
    '@import "other.css";',
    '.foo { background: url(https://example.com/dot.png); }',
    '.foo { background: u\\72l("https://example.com/dot.png"); }',
    '.foo { background: url(\\66ile:///etc/passwd); }',
    '.foo { background: url(/etc/passwd); }',
    '.foo { background: url(../../outside.svg); }',
    '.foo { background: image-set("https://example.com/dot.png" 1x); }',
    '.foo { background: url(../assets/missing.svg); }',
    '.foo { background: url("../assets/dot.svg");',
    '.foo { background: url("../assets/dot.svg); }',
    '.foo { & .bar { opacity: 0; } }',
    '@property --size { syntax:"<length>";initial-value:0px;inherits:true }',
  ])('rejects unbundled, escaping or malformed CSS: %s', async css => {
    await expect(compile(css)).rejects.toThrow()
  })

  it('rejects symlink escapes before reading resources', async () => {
    await writeFile(join(root, 'outside.svg'), '<svg/>')
    await symlink(join(root, 'outside.svg'), join(source, 'assets/link.svg'))
    await expect(compile('.a { mask: url(../assets/link.svg) }')).rejects.toThrow('escaped')
    const files = new LocalPluginFiles(join(root, 'profile'))
    await expect(files.snapshot(source)).rejects.toThrow('symlinks')
  })

  it('uses URL decoding inside the package and strips build source-map references', async () => {
    await writeFile(join(source, 'assets/soft dot.svg'), '<svg/>')
    const result = await compile(
      '.a { mask:url(../assets/soft%20dot.svg) } /*# sourceMappingURL=https://example.com/source.map */',
    )
    expect(result.themeStyles!.night).toContain('data:image/svg+xml;base64,')
    expect(result.themeStyles!.night).not.toContain('sourceMappingURL')
    await expect(compile('.a { mask:url(%2e%2e/%2e%2e/outside.svg) }')).rejects.toThrow('escaped')
  })

  it('bounds expanded resource references before constructing a large stylesheet', async () => {
    await writeFile(join(source, 'assets/large.png'), Buffer.alloc(5 * 1024 * 1024))
    await expect(
      compile('.a { background:url(../assets/large.png),url(../assets/large.png) }'),
    ).rejects.toThrow('12 MiB')
  })

  it('counts exported font sources in the response budget and deduplicates identical font faces', async () => {
    await writeFile(join(source, 'assets/large.woff2'), Buffer.alloc(5 * 1024 * 1024))
    await expect(
      compile('@font-face { font-family:Large; src:url(../assets/large.woff2) }'),
    ).rejects.toThrow('12 MiB')
    const result = await compile(
      '@font-face { font-family:Small; src:local(Arial) } @font-face { font-family:Small; src:local(Arial) }',
    )
    expect(result.themeFonts!.night).toHaveLength(1)
  })

  it.each(['media (min-width: 800px)', 'supports (display: grid)', 'layer fonts'])(
    'requires top-level font definitions instead of discarding @%s conditions in iframes',
    async condition => {
      await expect(
        compile(`@${condition} { @font-face { font-family:Small; src:local(Arial) } }`),
      ).rejects.toThrow('top level')
    },
  )

  it('rejects deeply nested functional selectors before recursive parsing', async () => {
    await expect(compile(`${':is('.repeat(40)}.a${')'.repeat(40)} { opacity:1 }`)).rejects.toThrow(
      '32 levels',
    )
  })

  it('enforces aggregate input and resource budgets', async () => {
    await expect(compile(`/*${'x'.repeat(256 * 1024)}*/`)).rejects.toThrow('256 KiB')
    await writeFile(join(source, 'assets/large.png'), Buffer.alloc(8 * 1024 * 1024 + 1))
    await expect(compile('.a { background: url(../assets/large.png) }')).rejects.toThrow('8 MiB')
  })

  it('reads details only from the installed artifact after the source changes or disappears', async () => {
    await compile(':root { --sample: url(../assets/dot.svg); }')
    const files = new LocalPluginFiles(join(root, 'profile'))
    const snapshot = await files.snapshot(source)
    const before = await files.readDetails(snapshot)
    expect(before.themeStyles?.night).toContain('data:image/svg+xml;base64,')
    await writeFile(join(source, theme.stylesheet), ':root { color: red }')
    await rm(source, { recursive: true, force: true })
    expect(await files.readDetails(snapshot)).toEqual(before)
    expect(await readFile(join(snapshot.directory, theme.stylesheet), 'utf8')).toContain('--sample')
    expect(await files.restore(snapshot)).toEqual(snapshot)
  })

  it('keeps the published revision active after a reload fails theme compilation', async () => {
    await compile(':root { --sample: url(../assets/dot.svg); }')
    const manager = new PluginInstallationManager({
      files: new LocalPluginFiles(join(root, 'profile')),
      backend: {
        start: async () => ({ invoke: async () => null, dispose: async () => undefined }),
      },
      createId: randomUUID,
      reservedIds: [],
    })
    managers.push(manager)
    await manager.install(source)
    const before = await manager.details(manifest.id)
    await writeFile(join(source, theme.stylesheet), '.a { background: url(missing.png); }')
    await expect(manager.reload(manifest.id)).rejects.toThrow()
    const after = await manager.details(manifest.id)
    expect(after.plugin.revision).toBe(before.plugin.revision)
    expect(after.plugin.status).toBe('ready')
    expect(after.themeStyles).toEqual(before.themeStyles)
  })
})
