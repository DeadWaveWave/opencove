import { afterEach, describe, expect, it, vi } from 'vitest'
import { Terminal, type ILink, type ILinkProvider } from '@xterm/xterm'
import { UrlLinkProvider } from '../../src/contexts/workspace/presentation/renderer/components/terminalNode/linkProviders/url-link-provider'
import { FilePathLinkProvider } from '../../src/contexts/workspace/presentation/renderer/components/terminalNode/linkProviders/file-path-link-provider'
import { OperatingSystem } from '../../src/contexts/workspace/presentation/renderer/components/terminalNode/linkProviders/link-parsing'
import {
  isTerminalLinkSnapshotCurrent,
  readTerminalLinkSnapshot,
} from '../../src/contexts/workspace/presentation/renderer/components/terminalNode/linkProviders/terminal-link-snapshot'

const terminals: Terminal[] = []

async function output(text: string, cols = 80): Promise<Terminal> {
  const terminal = new Terminal({ allowProposedApi: true, cols, rows: 24 })
  terminals.push(terminal)
  await new Promise<void>(resolve => terminal.write(text, resolve))
  return terminal
}

function linksAt(provider: ILinkProvider, row = 1): ILink[] {
  let result: ILink[] = []
  provider.provideLinks(row, links => {
    result = links ?? []
  })
  return result
}

function activate(link: ILink): void {
  link.activate(
    { metaKey: true, ctrlKey: true, preventDefault: vi.fn() } as unknown as MouseEvent,
    link.text,
  )
}

afterEach(() => {
  for (const terminal of terminals.splice(0)) {
    terminal.dispose()
  }
})

describe('terminal link recognition on real xterm buffers', () => {
  it('uses one-based inclusive cell ranges without including the next cell', async () => {
    const uri = 'https://example.com'
    const terminal = await output(`${uri} next`)
    const links = linksAt(new UrlLinkProvider(terminal, vi.fn()))
    expect(links).toHaveLength(1)
    expect(links[0]?.range).toEqual({ start: { x: 1, y: 1 }, end: { x: uri.length, y: 1 } })
  })

  it.each([
    ['中文 ', 6],
    ['e\u0301 ', 3],
  ])('maps UTF-16 offsets through terminal cells after %s', async (prefix, startX) => {
    const uri = 'https://example.com'
    const terminal = await output(`${prefix}${uri}`)
    expect(linksAt(new UrlLinkProvider(terminal, vi.fn()))[0]?.range).toEqual({
      start: { x: startX, y: 1 },
      end: { x: startX + uri.length - 1, y: 1 },
    })
  })

  it('returns the same complete URL from every row of a long soft wrap', async () => {
    const uri = `https://example.com/${'a'.repeat(72)}/end`
    const terminal = await output(uri, 20)
    const provider = new UrlLinkProvider(terminal, vi.fn())
    const expected = { start: { x: 1, y: 1 }, end: { x: uri.length % 20, y: 5 } }
    for (let row = 1; row <= 5; row++) {
      expect(linksAt(provider, row).map(link => ({ text: link.text, range: link.range }))).toEqual([
        { text: uri, range: expected },
      ])
    }
  })

  it('never joins a hard newline to an indented log message', async () => {
    const uri = 'https://example.com/api/'
    const terminal = await output(`${uri}\r\n  retrying request`)
    const provider = new UrlLinkProvider(terminal, vi.fn())
    expect(linksAt(provider).map(link => link.text)).toEqual([uri])
    expect(linksAt(provider, 2)).toEqual([])
  })

  it('preserves balanced URL punctuation, IPv6 authorities and query values', async () => {
    const uris = [
      'https://example.com/wiki/Foo_(bar)?next=https://other.test/a&x=a(b)!',
      'http://[::1]:3000/path?x=1',
    ]
    const terminal = await output(uris.join(' '), 160)
    expect(linksAt(new UrlLinkProvider(terminal, vi.fn())).map(link => link.text)).toEqual(uris)
  })

  it('excludes prose wrappers without removing balanced parentheses from a URL', async () => {
    const uri = 'https://example.com/Foo_(bar)'
    const terminal = await output(`See (${uri}).`)
    expect(linksAt(new UrlLinkProvider(terminal, vi.fn())).map(link => link.text)).toEqual([uri])
  })

  it('prefers the full Python quoted path and retains its source position', async () => {
    const terminal = await output('File "/tmp/my project/main.py", line 42')
    const onOpen = vi.fn()
    const links = linksAt(new FilePathLinkProvider(terminal, onOpen))
    expect(links).toHaveLength(1)
    activate(links[0]!)
    expect(onOpen.mock.calls[0]?.slice(1, 4)).toEqual(['/tmp/my project/main.py', 42, undefined])
  })

  it('preserves literal percent escapes in raw filesystem paths', async () => {
    const terminal = await output('./reports/a%20b.ts:42:7')
    const onOpen = vi.fn()
    const links = linksAt(new FilePathLinkProvider(terminal, onOpen))
    expect(links).toHaveLength(1)
    activate(links[0]!)
    expect(onOpen.mock.calls[0]?.slice(1, 4)).toEqual(['./reports/a%20b.ts', 42, 7])
  })

  it('keeps file navigation ranges and does not count wide text as one cell', async () => {
    const path = './src/中文.ts:42:7-45.9'
    const terminal = await output(`中文 ${path}`)
    const onOpen = vi.fn()
    const links = linksAt(new FilePathLinkProvider(terminal, onOpen))
    expect(links).toHaveLength(1)
    expect(links[0]?.range.start).toEqual({ x: 6, y: 1 })
    expect(links[0]?.range.end).toEqual({ x: 5 + path.length + 2, y: 1 })
    activate(links[0]!)
    expect(onOpen.mock.calls[0]?.slice(1)).toEqual(['./src/中文.ts', 42, 7, 45, 9])
  })

  it('rejects pathological wrapped input as a whole from every queried row', async () => {
    const terminal = await output(`https://example.com/${'a'.repeat(24_000)}`, 200)
    const provider = new UrlLinkProvider(terminal, vi.fn())
    for (const row of [1, 50, 120]) {
      expect(linksAt(provider, row)).toEqual([])
    }
  })

  it('maps a surrogate pair and combining cell without using code-unit widths', async () => {
    const terminal = await output('😀e\u0301 https://example.com')
    const line = terminal.buffer.active.getLine(0)!
    let startX = 0
    for (let column = 0; column < terminal.cols; column++) {
      if (line.getCell(column)?.getChars() === 'h') {
        startX = column + 1
      }
    }
    expect(linksAt(new UrlLinkProvider(terminal, vi.fn()))[0]?.range.start.x).toBe(startX)
  })

  it('does not insert a space where a wide character wraps before the final column', async () => {
    const path = `./${'a'.repeat(17)}中文.ts:42:7`
    const terminal = await output(path, 20)
    const provider = new FilePathLinkProvider(terminal, vi.fn())
    for (const row of [1, 2]) {
      expect(provider.getLinks(row).map(link => link.target)).toEqual([
        { kind: 'file', path: `./${'a'.repeat(17)}中文.ts`, line: 42, column: 7 },
      ])
    }
  })

  it('supports complete quoted paths without a tool prefix', async () => {
    const terminal = await output('See "/tmp/my project/notes.md":42:7 and \'./src/a b.ts\'.')
    expect(
      new FilePathLinkProvider(terminal, vi.fn()).getLinks(1).map(link => link.target),
    ).toEqual([
      { kind: 'file', path: '/tmp/my project/notes.md', line: 42, column: 7 },
      { kind: 'file', path: './src/a b.ts' },
    ])
  })

  it('does not offer file fragments inside a URL', async () => {
    const terminal = await output('https://example.com/src/a.ts:42:7 ftp://host/src/b.ts')
    expect(new FilePathLinkProvider(terminal, vi.fn()).getLinks(1)).toEqual([])
  })

  it('retains explicit file URI encoding for the destination resolver', async () => {
    const uri = 'file:///tmp/my%20project/a.ts:42:7'
    const terminal = await output(uri)
    expect(
      new FilePathLinkProvider(terminal, vi.fn()).getLinks(1).map(link => link.target),
    ).toEqual([{ kind: 'file', path: 'file:///tmp/my%20project/a.ts', line: 42, column: 7 }])
  })

  it('uses the source operating system independently of the renderer platform', async () => {
    const terminal = await output('C:\\project\\src\\file.ts:12:3')
    const provider = new FilePathLinkProvider(terminal, vi.fn(), {
      getSourceOS: () => OperatingSystem.Windows,
    })
    expect(provider.getLinks(1).map(link => link.target)).toEqual([
      { kind: 'file', path: 'C:\\project\\src\\file.ts', line: 12, column: 3 },
    ])
  })

  it('passes the detected snapshot to the interaction owner without modifier filtering', async () => {
    const terminal = await output('https://example.com')
    const onActivate = vi.fn()
    const onOpen = vi.fn()
    const provider = new UrlLinkProvider(terminal, onOpen, { onActivate })
    const link = linksAt(provider)[0]!
    const event = { metaKey: false, ctrlKey: false } as MouseEvent
    link.activate(event, link.text)
    expect(onActivate).toHaveBeenCalledWith(event, provider.getLinks(1)[0])
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('rejects activation and stale async results when the visible buffer has changed', async () => {
    const terminal = await output('https://example.com')
    const onActivate = vi.fn()
    const provider = new UrlLinkProvider(terminal, vi.fn(), { onActivate })
    const link = linksAt(provider)[0]!
    const snapshot = readTerminalLinkSnapshot(terminal, 1)!
    await new Promise<void>(resolve => terminal.write('\r\x1b[2Khttps://other.example', resolve))
    expect(isTerminalLinkSnapshotCurrent(terminal, snapshot)).toBe(false)
    activate(link)
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('bounds work for large unbroken non-link text', async () => {
    const terminal = await output('a'.repeat(16_000), 200)
    const start = performance.now()
    expect(new FilePathLinkProvider(terminal, vi.fn()).getLinks(1)).toEqual([])
    expect(performance.now() - start).toBeLessThan(500)
  })
})
