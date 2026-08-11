import { resizePtyAndReadAck } from '@platform/process/ptyHost/resizeAck'

describe('PTY host resize acknowledgement', () => {
  it('reports the geometry read back from the PTY rather than the request', () => {
    const pty = {
      cols: 80,
      rows: 24,
      resize: vi.fn(function (this: { cols: number; rows: number }) {
        this.cols = 91
        this.rows = 27
      }),
    }

    expect(resizePtyAndReadAck(pty, 120, 40, 'darwin')).toEqual({
      status: 'applied_verified',
      cols: 91,
      rows: 27,
    })
    expect(pty.resize).toHaveBeenCalledWith(120, 40)
  })

  it('keeps ConPTY resize application explicitly unverified', () => {
    const pty = { cols: 80, rows: 24, resize: vi.fn() }

    expect(resizePtyAndReadAck(pty, 120, 40, 'win32')).toEqual({
      status: 'applied_unverified',
    })
  })
})
