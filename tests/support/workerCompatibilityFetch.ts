/** Advertise this fixture Worker's delivery protocol without consuming operation responses. */
export function withWorkerCompatibility(delegate: typeof fetch): typeof fetch {
  return (input, init) => {
    const request = init?.body ? JSON.parse(String(init.body)) : null
    if (request?.id === 'system.capabilities') {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            __opencoveControlEnvelope: true,
            ok: true,
            value: { features: { managedClaudeResumeBindingDeliveryV1: true } },
          }),
        ),
      )
    }
    return delegate(input, init)
  }
}
