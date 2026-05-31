// SPDX-License-Identifier: Apache-2.0

import { Bullseye, Card, CardBody, CardTitle, Spinner } from '@patternfly/react-core'
import { useDashboardData } from '../dashboardContext'

export default function BackendHealthWidget() {
  const { health, healthError } = useDashboardData()
  return (
    <Card style={{ height: '100%' }}>
      <CardTitle>Backend health</CardTitle>
      <CardBody>
        {healthError && <span>error: {healthError}</span>}
        {!healthError && !health && (
          <Bullseye>
            <Spinner />
          </Bullseye>
        )}
        {health && <span>status: {health.status}</span>}
      </CardBody>
    </Card>
  )
}
