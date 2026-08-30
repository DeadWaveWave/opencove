import { describe, expect, it, vi } from 'vitest'
import { TerminalAgentInvocationRegistry } from '../../../src/contexts/agent/application/TerminalAgentInvocationRegistry'
import { TerminalAgentActivityGateway } from '../../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentActivityGateway'

describe('TerminalAgentActivityGateway lifecycle', () => {
  it('rejects a reservation racing with disposal after startup', async () => {
    const registry = new TerminalAgentInvocationRegistry()
    const reserveRegistryTerminal = vi.spyOn(registry, 'reserve')
    const gateway = new TerminalAgentActivityGateway({
      registry,
      resolveHookInjection: () => null,
    })
    await gateway.start()

    const reservation = gateway.reserveTerminal()
    const disposing = gateway.dispose()

    await expect(reservation).rejects.toThrow('Terminal Agent activity gateway is disposed.')
    await expect(disposing).resolves.toBeUndefined()
    expect(reserveRegistryTerminal).not.toHaveBeenCalled()
    await expect(gateway.start()).rejects.toThrow('Terminal Agent activity gateway is disposed.')
  })
})
