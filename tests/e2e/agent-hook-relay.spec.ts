import { test } from '@playwright/test'
import { registerAgentHookRelayTests } from './agent-hook-relay.helpers'

test.skip(process.platform === 'win32', 'Windows runs agent-hook-relay.windows.spec.ts')
registerAgentHookRelayTests()
