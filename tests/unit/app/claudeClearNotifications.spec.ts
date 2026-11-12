// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { clearIngressFixture } from './claudeClearIngress.helpers'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(close => close()))
})
async function fixture() {
  const f = await clearIngressFixture()
  cleanups.push(f.close)
  return f
}
const capability = () => ({ supported: true as const, submitDelayMs: 300 })
it.each(['idle_prompt', 'auth_success'])(
  'preserves first-prompt readiness across passive %s',
  async type => {
    const f = await fixture()
    await f.send('B', 'SessionStart', 10, undefined, 'clear')
    const before = f.fence()
    await f.send('B', 'Notification', 11, undefined, undefined, { notification_type: type })
    expect(f.fence()).toEqual(before)
    expect(promptAdmission(f.fence(), capability)).toBeNull()
    const delivery = f.deliver().catch(error => error)
    await vi.advanceTimersByTimeAsync(301)
    await f.send('B', 'UserPromptSubmit', Date.now() - 100000, 'b')
    expect(await delivery).toMatchObject({ phase: 'submission_observed' })
    expect(f.write).toHaveBeenCalledTimes(2)
  },
)
it.each(['idle_prompt', 'auth_success'])(
  'does not quarantine or advance provider order for early passive %s',
  async type => {
    const f = await fixture(),
      before = f.fence()
    await f.send('B', 'Notification', 100, undefined, undefined, { notification_type: type })
    expect(f.fence()).toEqual(before)
    await f.send('B', 'SessionStart', 10, undefined, 'clear')
    expect(promptAdmission(f.fence(), capability)).toBeNull()
  },
)
it.each(['permission_prompt', 'agent_needs_input'])(
  'still vetoes actual waiting notification %s',
  async type => {
    const f = await fixture()
    await f.send('B', 'SessionStart', 10, undefined, 'clear')
    await f.send('B', 'Notification', 11, undefined, undefined, { notification_type: type })
    expect(promptAdmission(f.fence(), capability)).toMatchObject({ code: 'agent.blocked' })
  },
)
