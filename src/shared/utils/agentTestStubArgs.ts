/** Forward provider argv only to the inert session script, never to the fallback shell. */
export function agentTestStubArgs(stub: readonly string[], provider: readonly string[]): string[] {
  return process.env.OPENCOVE_TEST_AGENT_SESSION_SCENARIO?.trim() &&
    process.env.OPENCOVE_TEST_AGENT_STUB_SCRIPT?.trim()
    ? [...stub, ...provider]
    : [...stub]
}
