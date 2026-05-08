// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react'
import {
  Bullseye,
  Card,
  CardBody,
  CardTitle,
  PageSection,
  Spinner,
  Title,
} from '@patternfly/react-core'

type Health = { status: string }

export default function DashboardPage() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch((e) => setError(String(e)))
  }, [])

  return (
    <>
      <PageSection>
        <Title headingLevel="h1">Dashboard</Title>
      </PageSection>
      <PageSection>
        <Card>
          <CardTitle>Backend health</CardTitle>
          <CardBody>
            {error && <span>error: {error}</span>}
            {!error && !health && (
              <Bullseye>
                <Spinner />
              </Bullseye>
            )}
            {health && <span>status: {health.status}</span>}
          </CardBody>
        </Card>
      </PageSection>
    </>
  )
}
