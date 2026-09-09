import React from 'react'
import { EndpointsSection } from './EndpointsSection'
import { ExperimentalWorkerWebUiSection } from './ExperimentalWorkerWebUiSection'
import { WorkerSection } from './WorkerSection'

export function WorkerConnectionsSection(): React.JSX.Element {
  return (
    <>
      <WorkerSection />
      <EndpointsSection />
      <ExperimentalWorkerWebUiSection />
    </>
  )
}
