// SPDX-License-Identifier: Apache-2.0

import { Bullseye, Card, CardBody, CardTitle, Spinner } from '@patternfly/react-core'
import { useDashboardData } from '../dashboardContext'

export default function BackendHealthWidget() {
  const { health, healthError } = useDashboardData()
  // Order matters: an error means the latest poll failed, so it
  // supersedes any cached health value the previous poll left behind.
  let body
  if (healthError) {
    body = <span>error: {healthError}</span>
  } else if (health) {
    body = <span>status: {health.status}</span>
  } else {
    body = (
      <Bullseye>
        <Spinner />
      </Bullseye>
    )
  }
  return (
    <Card style={{ height: '100%' }}>
      <CardTitle>Backend health</CardTitle>
      <CardBody>{body}</CardBody>
    </Card>
  )
}
