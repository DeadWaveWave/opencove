import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Terminal } from '@xterm/xterm'
import { createMountedXtermSession } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/xtermSession'

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    activate(): void {}
    dispose(): void {}
  },
}))

vi.mock('@xterm/addon-ligatures', () => ({
  LigaturesAddon: class {
    activate(): void {}
    dispose(): void {}
  },
}))

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {
    activate(): void {}
    dispose(): void {}
  },
}))

vi.mock('@xterm/addon-serialize', () => ({
  SerializeAddon: class {
    activate(): void {}
    dispose(): void {}
  },
}))

vi.mock('@xterm/addon-unicode11', () => ({
  Unicode11Addon: class {
    activate(): void {}
    dispose(): void {}
  },
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(function TerminalMock(
    this: {
      options: unknown
      unicode: Record<string, never>
      loadAddon: ReturnType<typeof vi.fn>
      registerLinkProvider: ReturnType<typeof vi.fn>
      open: ReturnType<typeof vi.fn>
      dispose: ReturnType<typeof vi.fn>
    },
    options,
  ) {
    this.options = options
    this.unicode = {}
    this.loadAddon = vi.fn()
    this.registerLinkProvider = vi.fn()
    this.open = vi.fn()
    this.dispose = vi.fn()
  }),
}))

vi.mock('../../../src/shared/runtime/terminalDisplayMeasurementRegistry', () => ({
  notifyTerminalDisplayMeasurementHandlesChanged: vi.fn(),
  registerTerminalDisplayMeasurementHandle: vi.fn(() => () => undefined),
}))

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/preferredRenderer',
  () => ({
    activatePreferredTerminalRenderer: vi.fn(() => ({
      kind: 'dom',
      clearTextureAtlas: vi.fn(),
      dispose: vi.fn(),
      setRasterScale: vi.fn(),
    })),
  }),
)

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/registerDiagnostics',
  () => ({
    registerTerminalDiagnostics: vi.fn(() => ({
      dispose: vi.fn(),
      log: vi.fn(),
      setRendererKind: vi.fn(),
      updateTitle: vi.fn(),
    })),
  }),
)

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/effectiveDevicePixelRatio',
  () => ({
    installTerminalEffectiveDevicePixelRatioController: vi.fn(() => ({
      dispose: vi.fn(),
      setViewportZoom: vi.fn(),
      setViewportInteractionActive: vi.fn(),
    })),
  }),
)

describe('createMountedXtermSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('window', {
      getComputedStyle: vi.fn(() => ({
        getPropertyValue: () => '',
      })),
      requestAnimationFrame: vi.fn(() => 1),
      open: vi.fn(),
      opencoveApi: {
        meta: {
          platform: 'win32',
        },
      },
    })
  })

  it('creates the xterm instance with the current terminal font family', () => {
    createMountedXtermSession({
      nodeId: 'node-1',
      ownerId: 'node-1:session-1',
      sessionIdForDiagnostics: 'session-1',
      nodeKindForDiagnostics: 'terminal',
      titleForDiagnostics: 'terminal',
      terminalProvider: null,
      terminalThemeMode: 'sync-with-ui',
      isTestEnvironment: false,
      container: null,
      initialDimensions: null,
      windowsPty: null,
      cursorBlink: true,
      disableStdin: false,
      fontSize: 13,
      fontFamily: 'Consolas',
      bindSearchAddonToFind: () => () => undefined,
      syncTerminalSize: () => undefined,
      diagnosticsEnabled: false,
      logTerminalDiagnostics: () => undefined,
    })

    expect(Terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        fontFamily: 'Consolas',
        fontSize: 13,
      }),
    )
  })
})
