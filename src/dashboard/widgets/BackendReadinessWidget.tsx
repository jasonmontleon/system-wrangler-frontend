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
  // Order matters: an error means the latest poll failed, so it
  // supersedes any cached readiness value the previous poll left behind.
  let body
  if (readinessError) {
    body = <span>error: {readinessError}</span>
  } else if (readiness) {
    const failingChecks = Object.entries(readiness.checks).filter(
      ([, result]) => result !== 'ok',
    )
    body = failingChecks.length === 0 ? (
      <span>status: {readiness.status}</span>
    ) : (
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
    )
  } else {
    body = (
      <Bullseye>
        <Spinner />
      </Bullseye>
    )
  }
  return (
    <Card style={{ height: '100%' }}>
      <CardTitle>Backend readiness</CardTitle>
      <CardBody>{body}</CardBody>
    </Card>
  )
}
