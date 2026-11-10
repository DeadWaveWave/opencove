import type { ShellCase } from './managedClaudeFallbackFaultCases'
import type { ManagedClaudeFaultOracle } from './managedClaudeFaultOracle'
import { shellContextPermitted } from './managedClaudeFallbackFaultContext'

export function assertFallbackOutcomes(input: {
  tasks: { name: string; nodeId: string; kind: 'launch' | 'prepare'; value?: unknown }[]
  config: ShellCase
  eventReached: boolean
  eventAfterReturn: boolean
  faultReached: boolean
  oracle: ManagedClaudeFaultOracle
}) {
  const { tasks, config, eventReached, eventAfterReturn, faultReached, oracle } = input
  for (const task of tasks) {
    if (task.name === 'replacement-rejected') {
      oracle.fallbackOutcome(task.name, task.value, 'rejected', false)
      continue
    }
    if (
      task.kind === 'launch' ||
      task.nodeId === 'peer' ||
      ((task.name.startsWith('restart-') ||
        (task.name === 'joining' &&
          (eventAfterReturn || /^(shellReturn|shellPersistence)/.test(config.edge)))) &&
        config.mode === 'failedResume')
    ) {
      oracle.outcome(
        task.name,
        task.value,
        { initial: 'fallback', fault: 'none', event: 'none', edge: 'identity:before' },
        false,
        false,
      )
    } else {
      const cancelled =
        eventReached &&
        !eventAfterReturn &&
        ['delete', 'newer', 'replace', 'replaceRejected', 'restart'].includes(config.event) &&
        !config.edge.startsWith('shellReturn') &&
        !config.edge.startsWith('shellPersistence')
      const empty =
        faultReached &&
        ['profile', 'activity', 'spawn', 'registration', 'activityCommit'].includes(config.fault)
      oracle.fallbackOutcome(
        task.name,
        task.value,
        task.name === 'primary' && (cancelled || !shellContextPermitted(config))
          ? 'rejected'
          : empty &&
              (task.name === 'primary' ||
                (task.name === 'joining' && !/^(shellReturn|shellPersistence)/.test(config.edge)))
            ? 'empty'
            : task.name === 'joining'
              ? 'joined'
              : 'shell',
        !eventReached || !['delete', 'replace', 'restart', 'prepare'].includes(config.event),
      )
    }
  }
}
