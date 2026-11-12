import type { Client } from './client'
import * as publication from '@contexts/workspace/presentation/renderer/utils/persistence/publicationState'
import type { PersistedAppState } from '@contexts/workspace/presentation/renderer/types'
import { assertCanonicalSpaceOrder } from './spaceOrdering'
import { value } from './fixture'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'

export function assertClientCanonicalState(client: Client, quiet: boolean) {
  const pending = publication.getPendingPublication()
  const draft =
    pending && publication.isPublicationBlocked(pending)
      ? (JSON.parse(
          ((pending && 'draftRaw' in pending ? pending!.draftRaw : null) as string) ??
            pending!.candidateRaw,
        ) as PersistedAppState)
      : null
  const accepted = publication.getSyncedPersistedState()
  assertCanonicalSpaceOrder([...client.caches].at(-1)?.latest?.state)
  client.server.model.check(
    {
      ui: value(client.state()),
      draft: draft ? value(draft) : null,
      accepted: accepted ? value(accepted) : null,
      revision: publication.getAcceptedRevision(),
      cache: [...client.caches].at(-1)?.latest?.state
        ? value([...client.caches].at(-1)!.latest!.state!)
        : null,
      viewConsistent:
        !accepted ||
        publication.canAcceptCanonicalState(accepted, publication.getAcceptedRevision()) ===
          publication.canAcceptCanonicalState(
            {
              ...accepted,
              workspaces: accepted.workspaces.map(w => ({
                ...w,
                viewport: { x: 999, y: 2, zoom: 3 },
              })),
            },
            publication.getAcceptedRevision(),
          ),
      surfaced: !!useAppStore.getState().persistNotice,
      acceptedVerified: accepted?.workspaces[0].nodes[0].agent?.resumeSessionIdVerified === true,
      verified:
        useAppStore.getState().workspaces[0].nodes[0].data.agent?.resumeSessionIdVerified === true,
    },
    quiet,
    client.owned,
  )
}
