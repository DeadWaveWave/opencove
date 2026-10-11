import { copyFile, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const themePluginId = 'theme-studio-fixture'
export const themeIdentity = (name: string) => `plugin:${themePluginId}:${name}`

export async function createThemePlugin(options: { includeFont?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'opencove-theme-studio-'))
  await writeFile(
    join(directory, 'opencove.plugin.json'),
    JSON.stringify({
      apiVersion: 1,
      id: themePluginId,
      version: '1.0.0',
      displayName: 'Theme studio fixture',
      description: 'An independent author theme and SDK observer.',
      view: { entry: 'index.html', instances: 'multiple', width: 380, height: 260 },
      contributes: {
        themes: [
          {
            id: 'pixel-copy',
            title: 'Pixel copy',
            appearance: 'dark',
            extends: 'pixel',
            tokens: {},
          },
          {
            id: 'light-copy',
            title: 'Pixel light copy',
            appearance: 'light',
            extends: 'pixel-light',
            tokens: {},
          },
          {
            id: 'studio',
            title: 'Studio',
            appearance: 'dark',
            extends: 'pixel',
            tokens: { '--cove-accent': '#ffa977' },
            stylesheet: 'skin.css',
            typography: { fontFamily: '"Courier New", monospace', fontSize: 16, titleFontSize: 14 },
            metrics: { headerHeight: 44, headerPadding: 14, iconSize: 20, compactIconSize: 30 },
          },
        ],
      },
    }),
  )
  if (options.includeFont) {
    // Reuse an installed, redistributable font fixture; never depend on machine fonts.
    await copyFile(
      resolve(
        __dirname,
        '../../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.ttf',
      ),
      join(directory, 'theme-fixture.ttf'),
    )
  }
  const fontRule = options.includeFont
    ? '@font-face { font-family: "Theme Fixture Icons"; src: url("./theme-fixture.ttf") format("truetype"); font-display: swap; } [data-cove-part="space-title"]::before { content: "\\ea60"; font-family: "Theme Fixture Icons"; margin-right: 6px; }'
    : ''
  await writeFile(
    join(directory, 'skin.css'),
    `${fontRule}\n[data-cove-part="window-header"] { background-image: linear-gradient(90deg, #583b70, #203d54); }
     [data-cove-part="window-title"] { color: #ffe9c4; }
     [data-cove-part="icon"][data-cove-kind="note"] { background: url('./note.svg') center / contain no-repeat; }
     [data-cove-part="icon"][data-cove-kind="note"] > * { visibility: hidden; }
     [data-cove-part="compact-base"] { box-shadow: 0 5px 14px #164448; }
     [data-cove-part="space"]::after { border-color: #ffa977; }
     [data-cove-part="sidebar"] { background: #17232a; }`,
  )
  await writeFile(
    join(directory, 'note.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#ffa977" d="M4 4h16v16H4z"/><path fill="#17232a" d="M8 8h8v2H8zm0 5h8v2H8z"/></svg>',
  )
  await writeFile(
    join(directory, 'index.html'),
    '<!doctype html><html><head><script src="view.js" defer></script></head><body><output id="context"></output><input id="draft" aria-label="Uncommitted draft"></body></html>',
  )
  await writeFile(
    join(directory, 'view.js'),
    `const render = context => { document.querySelector('#context').textContent = JSON.stringify({ ...context, fonts: context.fonts?.map(({ family }) => ({ family })) }); };
     window.opencovePlugin.ready.then(render);
     window.opencovePlugin.onThemeChange((_theme, _colors, context) => render(context));`,
  )
  return directory
}
