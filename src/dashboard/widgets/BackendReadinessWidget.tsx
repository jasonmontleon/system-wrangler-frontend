// SPDX-License-Identifier: Apache-2.0

import { Bullseye, Card, CardBody, CardTitle, Spinner } from '@patternfly/react-core'
import { useDashboardData } from '../dashboardContext'

// BackendReadinessWidget mirrors the BackendHealthWidget S-cell card but
// surfaces the readiness probe instead of the liveness one. When any
// check fails the body lists the failing checks rather than a single
// terse status string, so an operator can tell which dependency is the
// blocker.
export default function BackendReadinessWidget() {
  const { readiness, readinessError } = useDashboardData()
  const failingChecks = readiness
    ? Object.entries(readiness.checks).filter(([, result]) => result !== 'ok')
    : []
  return (
    <Card style={{ height: '100%' }}>
      <CardTitle>Backend readiness</CardTitle>
      <CardBody>
        {readinessError && <span>error: {readinessError}</span>}
        {!readinessError && !readiness && (
          <Bullseye>
            <Spinner />
          </Bullseye>
        )}
        {readiness && failingChecks.length === 0 && (
          <span>status: {readiness.status}</span>
        )}
        {readiness && failingChecks.length > 0 && (
          <div>
            <div>status: {readiness.status}</div>
            <ul style={{ marginTop: '0.5rem', paddingLeft: '1.25rem' }}>
              {failingChecks.map(([name, result]) => (
                <li key={name}>
                  {name}: {result}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
