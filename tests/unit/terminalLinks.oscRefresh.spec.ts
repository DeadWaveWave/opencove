import { Terminal, type IBufferRange } from '@xterm/xterm'
import { afterEach, expect, it, vi } from 'vitest'
import { installTerminalLinks } from '../../src/contexts/workspace/presentation/renderer/components/terminalNode/links/installTerminalLinks'
import {
  TERMINAL_LINK_EVENT,
  type TerminalLinkIntent,
} from '../../src/contexts/workspace/presentation/renderer/components/terminalNode/links/linkHostEvent'

const uri = 'https://example.com/hidden-target?source=osc8'
const label = 'https://example.com/displayed-label'
const range: IBufferRange = { start: { x: 1, y: 1 }, end: { x: label.length, y: 1 } }
const cleanup: (() => void)[] = []
const write = (terminal: Terminal, text: string) =>
  new Promise<void>(resolve => terminal.write(text, resolve))

afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach(dispose => dispose())
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function setup() {
  // Real parser/buffer, with the native render/hover boundary advanced explicitly.
  const terminal = new Terminal({ allowProposedApi: true, cols: 80, rows: 4 })
  cleanup.push(() => terminal.dispose())
  const element = document.createElement('div')
  const screen = element.appendChild(document.createElement('div'))
  screen.className = 'xterm-screen'
  document.body.appendChild(element)
  cleanup.push(() => element.remove())
  vi.spyOn(terminal, 'element', 'get').mockReturnValue(element)
  vi.spyOn(screen, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 80))
  vi.spyOn(terminal, 'refresh').mockImplementation(() => undefined)
  vi.spyOn(terminal, 'hasSelection').mockReturnValue(false)
  let render: (rows: { start: number; end: number }) => void = () => undefined
  vi.spyOn(terminal, 'onRender', 'get').mockReturnValue(listener => {
    render = listener
    return { dispose() {} }
  })
  const intents: TerminalLinkIntent[] = []
  element.addEventListener(TERMINAL_LINK_EVENT, event => {
    intents.push((event as CustomEvent<TerminalLinkIntent>).detail)
  })
  const registerProvider = vi.spyOn(terminal, 'registerLinkProvider')
  const dispose = installTerminalLinks(terminal)
  const provider = registerProvider.mock.calls[0]![0]
  cleanup.push(dispose)
  await write(terminal, `\x1b]8;;${uri}\x07${label}\x1b]8;;\x07`)
  const mouse = (type: string, options: MouseEventInit = {}) =>
    new MouseEvent(type, {
      bubbles: true,
      clientX: 115,
      clientY: 10,
      button: 0,
      detail: 1,
      ...options,
    })
  const hover = (target = uri) =>
    terminal.options.linkHandler!.hover!(mouse('mousemove'), target, range)
  // Finish the initial render, then establish a native OSC hover just like xterm.
  render({ start: 0, end: 3 })
  hover()
  await Promise.resolve()
  const refresh = async (target: string | null = uri) => {
    render({ start: 0, end: 2 })
    if (target === null) {
      provider.provideLinks(1, links => links?.[0]?.hover?.(mouse('mousemove'), label))
    } else {
      hover(target)
    }
    await Promise.resolve()
  }
  const click = () => {
    screen.dispatchEvent(mouse('mousedown'))
    screen.dispatchEvent(mouse('mouseup'))
  }
  vi.useFakeTimers()
  const output = async (text: string) => {
    const parsed = write(terminal, text)
    await vi.advanceTimersByTimeAsync(0)
    await parsed
  }
  return { terminal, intents, click, refresh, mouse, screen, dispose, output }
}

const menus = (intents: TerminalLinkIntent[]) =>
  intents.filter(intent => intent.action === 'menu').map(intent => intent.text)

it.each(['before down', 'between down/up', 'after up'])(
  'keeps an ordinary OSC click when unrelated output arrives %s',
  async timing => {
    const { terminal, intents, screen, mouse, refresh, output } = await setup()
    if (timing !== 'before down') {
      screen.dispatchEvent(mouse('mousedown'))
    }
    if (timing === 'after up') {
      screen.dispatchEvent(mouse('mouseup'))
    }
    await output('\x1b[3;1HUNRELATED_OUTPUT')
    expect(terminal.buffer.active.getLine(2)?.translateToString(true)).toBe('UNRELATED_OUTPUT')
    if (timing === 'before down') {
      screen.dispatchEvent(mouse('mousedown'))
    }
    if (timing !== 'after up') {
      screen.dispatchEvent(mouse('mouseup'))
    }
    await refresh()
    await vi.advanceTimersByTimeAsync(250)
    expect(menus(intents)).toEqual([uri])
  },
)

it('waits for native validation even when rendering takes longer than the single-click delay', async () => {
  const { intents, click, refresh, output } = await setup()
  await output('\x1b[3;1HUNRELATED_OUTPUT')
  click()
  await vi.advanceTimersByTimeAsync(1000)
  expect(menus(intents)).toEqual([])
  await refresh()
  expect(menus(intents)).toEqual([uri])
  await refresh()
  expect(menus(intents)).toEqual([uri])
})

it('rejects a changed OSC destination even when the displayed text is identical', async () => {
  const { intents, click, refresh, output } = await setup()
  const replacement = 'https://example.com/replacement'
  await output(`\x1b[1;1H\x1b]8;;${replacement}\x07${label}\x1b]8;;\x07`)
  click()
  await refresh(replacement)
  await vi.advanceTimersByTimeAsync(250)
  expect(menus(intents)).toEqual([])
  click()
  await vi.advanceTimersByTimeAsync(250)
  expect(menus(intents)).toEqual([replacement])
})

it('does not redirect a retained OSC click to its label when the OSC attributes are removed', async () => {
  const { intents, click, refresh, output } = await setup()
  await output(`\x1b[1;1H${label}`)
  click()
  await refresh(null)
  await vi.advanceTimersByTimeAsync(250)
  expect(menus(intents)).toEqual([])
  click()
  await vi.advanceTimersByTimeAsync(250)
  expect(menus(intents)).toEqual([label])
})

it.each(['drag', 'double click', 'Escape', 'outside click', 'blur', 'dispose'])(
  'cancels the retained click on %s before a delayed refresh',
  async cancel => {
    const { intents, screen, mouse, refresh, dispose, output } = await setup()
    await output('\x1b[3;1HUNRELATED_OUTPUT')
    screen.dispatchEvent(mouse('mousedown'))
    if (cancel === 'drag') {
      screen.dispatchEvent(mouse('mousemove', { clientX: 135 }))
    }
    screen.dispatchEvent(mouse('mouseup'))
    if (cancel === 'double click') {
      screen.dispatchEvent(mouse('dblclick', { detail: 2 }))
    } else if (cancel === 'Escape') {
      screen.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    } else if (cancel === 'outside click') {
      document.body.dispatchEvent(mouse('mouseup'))
    } else if (cancel === 'blur') {
      window.dispatchEvent(new Event('blur'))
    } else if (cancel === 'dispose') {
      dispose()
    }
    if (cancel !== 'dispose') {
      await refresh()
    }
    await vi.advanceTimersByTimeAsync(1000)
    expect(menus(intents)).toEqual([])
  },
)
