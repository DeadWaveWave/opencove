import React from 'react'
import { applyUiLanguage } from '../../src/app/renderer/i18n'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalLinkHost } from '../../src/contexts/workspace/presentation/renderer/components/terminalNode/links/TerminalLinkHost'
import {
  TERMINAL_LINK_EVENT,
  type TerminalLinkIntent,
} from '../../src/contexts/workspace/presentation/renderer/components/terminalNode/links/linkHostEvent'

const stat = vi.fn()
const open = vi.fn()
const environment = vi.fn()
const copy = vi.fn()
const systemOpen = vi.fn()
const canSystemOpen = vi.fn()
vi.mock('../../src/contexts/workspace/presentation/renderer/utils/terminalLinkApi', () => ({
  statTerminalLink: (...args: unknown[]) => stat(...args),
  openTerminalUrl: (...args: unknown[]) => open(...args),
  getTerminalLinkEnvironment: (...args: unknown[]) => environment(...args),
  getTerminalSystemOpenCapability: () => Promise.resolve(true),
  copyTerminalLink: (...args: unknown[]) => copy(...args),
  openTerminalTargetWithSystem: (...args: unknown[]) => systemOpen(...args),
  canOpenTerminalTargetWithSystem: (...args: unknown[]) => canSystemOpen(...args),
}))
let container: HTMLDivElement
function intent(overrides: Partial<TerminalLinkIntent> = {}): TerminalLinkIntent {
  return {
    action: 'open',
    target: { kind: 'url', uri: 'https://example.com/?a=%2B' },
    text: 'example',
    clientX: 10,
    clientY: 10,
    bufferRow: 1,
    isCurrent: () => true,
    focusTerminal: vi.fn(),
    ...overrides,
  }
}
function dispatch(value: TerminalLinkIntent) {
  act(() =>
    container.dispatchEvent(new CustomEvent(TERMINAL_LINK_EVENT, { detail: value, bubbles: true })),
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  environment.mockResolvedValue({ platform: 'posix', home: '/home/test' })
  stat.mockResolvedValue({ kind: 'file' })
  copy.mockResolvedValue(undefined)
  systemOpen.mockResolvedValue(true)
  canSystemOpen.mockImplementation(
    (target: { endpointId?: string }, local: boolean) => target.endpointId === 'local' && local,
  )
  container = document.createElement('div')
  document.body.append(container)
})
afterEach(async () => {
  container.remove()
  await applyUiLanguage('en')
})
describe('terminal link action boundary', () => {
  it('opens known URLs synchronously without waiting for file or environment IO', () => {
    environment.mockReturnValue(new Promise(() => {}))
    render(<TerminalLinkHost containerRef={{ current: container }} sessionId="one" options={{}} />)
    dispatch(intent())
    expect(open).toHaveBeenCalledExactlyOnceWith('https://example.com/?a=%2B')
    expect(stat).not.toHaveBeenCalled()
  })
  it('requires explicit launch-directory confirmation and preserves file positions', async () => {
    const onOpenFileLink = vi.fn().mockResolvedValue(true)
    render(
      <TerminalLinkHost
        containerRef={{ current: container }}
        sessionId="one"
        options={{ executionDirectory: '/repo', onOpenFileLink }}
      />,
    )
    dispatch(intent({ target: { kind: 'file', path: './src/a.ts', line: 42, column: 7 } }))
    await screen.findByText(/launch directory/)
    expect(onOpenFileLink).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Open (file|in browser)/ }))
    await waitFor(() =>
      expect(onOpenFileLink).toHaveBeenCalledWith(
        expect.objectContaining({ uri: 'file:///repo/src/a.ts', line: 42, column: 7 }),
      ),
    )
  })
  it('discards an old async file result when the originating session changes', async () => {
    let resolveStat!: (result: { kind: 'file' }) => void
    stat.mockReturnValue(
      new Promise(resolve => {
        resolveStat = resolve
      }),
    )
    const onOpenFileLink = vi.fn()
    const ref = { current: container }
    const view = render(
      <TerminalLinkHost containerRef={ref} sessionId="one" options={{ onOpenFileLink }} />,
    )
    dispatch(intent({ target: { kind: 'file', path: '/repo/a.ts' } }))
    await waitFor(() => expect(stat).toHaveBeenCalled())
    view.rerender(
      <TerminalLinkHost containerRef={ref} sessionId="two" options={{ onOpenFileLink }} />,
    )
    await act(async () => resolveStat({ kind: 'file' }))
    expect(onOpenFileLink).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('does not redirect remote localhost URLs into the client machine', async () => {
    render(
      <TerminalLinkHost
        containerRef={{ current: container }}
        sessionId="one"
        options={{ workerBinding: { endpointId: 'remote', mountId: 'mount' } }}
      />,
    )
    dispatch(intent({ target: { kind: 'url', uri: 'http://localhost:3000' } }))
    expect(open).not.toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: /Open (file|in browser)/ })).toBeDisabled()
  })
  it('keeps terminal focus until keyboard navigation enters the menu and restores it on Escape', () => {
    render(<TerminalLinkHost containerRef={{ current: container }} sessionId="one" options={{}} />)
    const link = intent({ action: 'menu' })
    dispatch(link)
    expect(screen.getByRole('button', { name: /Open (file|in browser)/ })).not.toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByRole('button', { name: /Open (file|in browser)/ })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(link.focusTerminal).toHaveBeenCalledOnce()
  })
  it.each(['resolve', 'reject'] as const)(
    'ignores late clipboard %s after another menu opens',
    async outcome => {
      let finish!: () => void
      copy.mockReturnValue(
        new Promise<void>((resolve, reject) => {
          finish = () => (outcome === 'resolve' ? resolve() : reject(new Error('clipboard failed')))
        }),
      )
      render(
        <TerminalLinkHost containerRef={{ current: container }} sessionId="one" options={{}} />,
      )
      const old = intent({ action: 'menu' })
      dispatch(old)
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
      dispatch(intent({ action: 'menu', target: { kind: 'url', uri: 'https://next.example/' } }))
      await act(async () => finish())
      expect(screen.getByText('https://next.example/')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Open (file|in browser)/ })).not.toBeDisabled()
      expect(old.focusTerminal).not.toHaveBeenCalled()
    },
  )
  it('renders translated link actions in Chinese', async () => {
    await applyUiLanguage('zh-CN')
    render(<TerminalLinkHost containerRef={{ current: container }} sessionId="one" options={{}} />)
    dispatch(intent({ action: 'menu' }))
    expect(screen.getByRole('button', { name: /在浏览器中打开/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: '复制', exact: true })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '关闭', exact: true })).not.toBeInTheDocument()
  })
  it('opens an existing local directory in the system without requiring a Space', async () => {
    stat.mockResolvedValue({ kind: 'directory' })
    const onOpenFileLink = vi.fn().mockResolvedValue(false)
    render(
      <TerminalLinkHost
        containerRef={{ current: container }}
        sessionId="one"
        options={{ onOpenFileLink }}
      />,
    )
    dispatch(
      intent({ target: { kind: 'file', path: 'file:///Users/example/Development/nosh_android' } }),
    )
    await waitFor(() =>
      expect(systemOpen).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'directory',
          path: '/Users/example/Development/nosh_android',
          endpointId: 'local',
        }),
        true,
      ),
    )
    expect(onOpenFileLink).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('renders hover as a terminal status strip and offers no action card', () => {
    render(<TerminalLinkHost containerRef={{ current: container }} sessionId="one" options={{}} />)
    dispatch(intent({ action: 'hover' }))
    expect(container.querySelector('[role="tooltip"]')).not.toBeNull()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
  it('shows a native path and an explicit system action for local files', async () => {
    render(<TerminalLinkHost containerRef={{ current: container }} sessionId="one" options={{}} />)
    dispatch(intent({ action: 'menu', target: { kind: 'file', path: 'file:///repo/a.ts' } }))
    expect(await screen.findByText('/repo/a.ts')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Open with default app/ }))
    await waitFor(() =>
      expect(systemOpen).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/repo/a.ts' }),
        true,
      ),
    )
  })
  it('uses the system application for a direct alternate file gesture', async () => {
    const onOpenFileLink = vi.fn()
    render(
      <TerminalLinkHost
        containerRef={{ current: container }}
        sessionId="one"
        options={{ onOpenFileLink }}
      />,
    )
    dispatch(intent({ target: { kind: 'file', path: '/repo/a.ts' }, preferSystem: true }))
    await waitFor(() => expect(systemOpen).toHaveBeenCalledOnce())
    expect(onOpenFileLink).not.toHaveBeenCalled()
  })
  it('routes a remote directory through its workspace instead of the local system', async () => {
    stat.mockResolvedValue({ kind: 'directory' })
    const onOpenFileLink = vi.fn().mockResolvedValue(true)
    render(
      <TerminalLinkHost
        containerRef={{ current: container }}
        sessionId="one"
        options={{ workerBinding: { endpointId: 'remote', mountId: 'mount' }, onOpenFileLink }}
      />,
    )
    dispatch(intent({ target: { kind: 'file', path: '/repo' } }))
    await waitFor(() =>
      expect(onOpenFileLink).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'directory', endpointId: 'remote', mountId: 'mount' }),
      ),
    )
    expect(systemOpen).not.toHaveBeenCalled()
  })
  it('restores terminal focus when opening a URL from the keyboard action', () => {
    render(<TerminalLinkHost containerRef={{ current: container }} sessionId="one" options={{}} />)
    const link = intent({ action: 'menu' })
    dispatch(link)
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    const primary = screen.getByRole('button', { name: /Open in browser/ })
    expect(primary).toHaveFocus()
    fireEvent.click(primary)
    expect(link.focusTerminal).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('preserves revoked permission errors and keeps Copy reachable by keyboard', async () => {
    const onOpenFileLink = vi.fn()
    render(
      <TerminalLinkHost
        containerRef={{ current: container }}
        sessionId="one"
        options={{ onOpenFileLink }}
      />,
    )
    dispatch(intent({ action: 'menu', target: { kind: 'file', path: '/repo/a.ts' } }))
    await screen.findByText('/repo/a.ts')
    stat.mockResolvedValue({ reason: 'forbidden' })
    fireEvent.click(screen.getByRole('button', { name: /Open file/ }))
    await screen.findByText(/outside the allowed/i)
    expect(onOpenFileLink).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Copy', exact: true })).toHaveFocus()
  })
})
