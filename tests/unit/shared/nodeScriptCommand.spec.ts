import { describe, expect, it } from 'vitest'
import { resolveNodeScriptLaunch } from '../../../src/shared/utils/nodeScriptCommand'

describe('resolveNodeScriptLaunch', () => {
  it('prefers an explicit node override when provided', () => {
    expect(
      resolveNodeScriptLaunch('/tmp/test-agent-session-stub.mjs', ['codex', '/tmp/workspace'], {
        env: {
          OPENCOVE_TEST_NODE_EXECUTABLE: '/custom/bin/node-wrapper',
        },
        execPath: '/Applications/OpenCove.app/Contents/MacOS/OpenCove',
      }),
    ).toEqual({
      command: '/custom/bin/node-wrapper',
      args: ['/tmp/test-agent-session-stub.mjs', 'codex', '/tmp/workspace'],
    })
  })

  it('uses the current runtime when it is already Node', () => {
    expect(
      resolveNodeScriptLaunch('/tmp/test-agent-session-stub.mjs', ['codex', '/tmp/workspace'], {
        env: { npm_node_execpath: '/usr/local/bin/node' },
        execPath: '/usr/local/bin/node',
      }),
    ).toEqual({
      command: '/usr/local/bin/node',
      args: ['/tmp/test-agent-session-stub.mjs', 'codex', '/tmp/workspace'],
    })
  })

  it('falls back to the current runtime with ELECTRON_RUN_AS_NODE when only Electron is known', () => {
    expect(
      resolveNodeScriptLaunch('/tmp/test-agent-session-stub.mjs', ['opencode', '/tmp/workspace'], {
        env: {},
        execPath: '/Applications/OpenCove.app/Contents/MacOS/OpenCove',
      }),
    ).toEqual({
      command: '/Applications/OpenCove.app/Contents/MacOS/OpenCove',
      args: ['/tmp/test-agent-session-stub.mjs', 'opencode', '/tmp/workspace'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    })
  })
})
